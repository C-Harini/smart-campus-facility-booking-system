import Anthropic from '@anthropic-ai/sdk';
import { executeTool, TOOL_DEFS } from './agentTools.js';
import { nowInTz, addDays, dayName } from '../utils/time.js';

export const llmEnabled = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.GEMINI_API_KEY);

let client;
const getAnthropicClient = () => (client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }));

function buildSystemPrompt(user, session) {
  const now = nowInTz();
  const calendar = Array.from({ length: 15 }, (_, i) => {
    const d = addDays(now.date, i);
    const label = i === 0 ? ' (today)' : i === 1 ? ' (tomorrow)' : '';
    return `${dayName(d)} ${d}${label}`;
  }).join('\n');

  const adminInstructions = user.role === 'admin' ? `
ADMIN CAPABILITIES (the user is an Administrator):
- View pending booking requests using listPendingBookings (you can filter by date).
- Approve or reject pending bookings using decideBookingAdmin (Confirmed or Rejected, optional note).
- List, add, modify, or deactivate facilities using listFacilitiesAdmin, addFacilityAdmin, updateFacilityAdmin, deactivateFacilityAdmin.
- View system overview and statistics using getAdminStats.` : '';

  return `You are "Campus Booking Assistant", the booking agent for a university's Smart Campus Facility Booking System. You are chatting with ${user.name} (${user.role}).

Current date/time: ${now.date} ${now.time} (${process.env.TIMEZONE || 'Asia/Kolkata'}).
Calendar (use it to resolve "tomorrow", "next Monday", etc.):
${calendar}

Details collected so far in this conversation (bookingContext): ${JSON.stringify(session.bookingContext || {})}
${adminInstructions}

HOW YOU WORK
- You can ONLY read or change data through the provided tools. Never invent facilities, availability, booking IDs or statuses. If you need a fact, call a tool.
- Detect the user's intent and extract entities (facility type/name, date, start/end time, participants, purpose, booking ID).
- For facility recommendations, use suggestFacilities to find top matches based on capacity and equipment.
- After a message that adds information, call updateBookingContext to store it (with the intent).
- Missing information: ask for ONE missing item per message, never a list of questions. A booking needs: facility (type or name), date, start time, end time, participants, purpose. Do not ask for things the user already gave.
- When you have facility type + date + time (+ participants), call findAvailableFacilities (or checkAvailability for a named facility) BEFORE offering a booking.
- If the slot is busy or invalid, explain briefly and offer the free ranges returned by the tool, then ask which they prefer.
- Before booking, show a summary (facility, date, time, participants, purpose) and ask "Shall I confirm the booking?". Call createBooking ONLY after the user clearly says yes, with userConfirmed true. Same for cancelBooking.
- Only say a booking is confirmed/created/cancelled if the tool result has ok:true, and quote the bookingId from that result. If a tool returns ok:false, tell the user it could not be completed and why. If status is "Pending", say it is awaiting admin approval.
- Tool arguments: dates YYYY-MM-DD, times 24-hour HH:mm. In your replies to the user, write times in 12-hour format (2:00 PM) and dates like "10 October 2026".
- Bare times like "2 to 4" on campus mean daytime (2 PM to 4 PM). Ask if truly ambiguous.
- Stay on topic (campus facilities, administration, and bookings). Be warm, concise (1-4 short sentences), plain text; **bold** is allowed for facility names and booking IDs. No tables or markdown headings.`;
}

const ID_RX = /\bFAC\d{3,}\b/gi;

/** Last line of defence: never let the model claim an outcome the backend did not produce. */
export function guardReply(reply, trace, session) {
  const ok = (name) => trace.some((t) => t.name === name && t.output?.ok === true);
  const known = new Set();
  for (const m of session.messages) for (const id of m.content.match(ID_RX) || []) known.add(id.toUpperCase());
  for (const t of trace) for (const id of JSON.stringify(t.output || {}).match(ID_RX) || []) known.add(id.toUpperCase());
  for (const id of reply.match(ID_RX) || []) {
    if (!known.has(id.toUpperCase())) {
      return "Sorry, I couldn't verify that booking ID, so I haven't confirmed anything. Please check My Bookings or ask me to list your bookings.";
    }
  }
  const claimsBooked = /\b(?:has been|have been|is now|was|successfully)\s+(?:confirmed|booked|created|made)\b|\bbooking (?:is )?confirmed\b|\bbooked successfully\b/i.test(reply);
  const claimsCancelled = /\b(?:has been|have been|was|successfully)\s+cancell?ed\b/i.test(reply);
  const readOnlyOk = ok('getMyBookings') || ok('getBookingStatus') || ok('listPendingBookings') || ok('decideBookingAdmin') || ok('getAdminStats');
  if (claimsBooked && !ok('createBooking') && !ok('decideBookingAdmin') && !readOnlyOk) {
    return "I haven't completed a booking yet, so nothing has been saved. Tell me to confirm once you're happy with the details and I'll try again.";
  }
  if (claimsCancelled && !ok('cancelBooking') && !readOnlyOk) {
    return "I haven't cancelled anything yet. Please confirm which booking you'd like to cancel and I'll process it.";
  }
  return reply;
}

async function runAnthropicAgent({ session, user }) {
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
  const ctx = { user, session, bookingChanged: false, booking: null };

  const history = session.messages.slice(-20).map((m) => ({ role: m.role, content: m.content }));
  while (history.length && history[0].role !== 'user') history.shift();

  const messages = [...history];
  const trace = [];

  for (let i = 0; i < 8; i++) {
    const res = await getAnthropicClient().messages.create({
      model,
      max_tokens: 1024,
      system: buildSystemPrompt(user, session),
      tools: TOOL_DEFS,
      messages,
    });

    if (res.stop_reason === 'tool_use') {
      messages.push({ role: 'assistant', content: res.content });
      const results = [];
      for (const block of res.content.filter((b) => b.type === 'tool_use')) {
        const output = await executeTool(block.name, block.input, ctx);
        trace.push({ name: block.name, input: block.input, output });
        results.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(output),
          is_error: output.ok === false,
        });
      }
      messages.push({ role: 'user', content: results });
      continue;
    }

    const text = res.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    const reply = guardReply(text || 'Sorry, I did not catch that. Could you rephrase?', trace, session);
    return {
      reply,
      intent: session.intent,
      bookingChanged: ctx.bookingChanged,
      booking: ctx.booking,
    };
  }
  throw new Error('LLM agent exceeded the tool-call limit');
}

async function runGeminiAgent({ session, user }) {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const ctx = { user, session, bookingChanged: false, booking: null };
  const systemText = buildSystemPrompt(user, session);

  const functionDeclarations = TOOL_DEFS.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.input_schema,
  }));

  const contents = session.messages.slice(-15).map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));
  while (contents.length && contents[0].role !== 'user') contents.shift();

  const trace = [];

  for (let step = 0; step < 6; step++) {
    const payload = {
      systemInstruction: { parts: [{ text: systemText }] },
      contents,
      tools: [{ functionDeclarations }],
    };

    let res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    // If 503 (temporary high demand) or 429, try alternative model
    if (res.status === 503 || res.status === 429) {
      const altModel = model === 'gemini-3.5-flash' ? 'gemini-2.5-flash' : 'gemini-3.5-flash';
      const altUrl = `https://generativelanguage.googleapis.com/v1beta/models/${altModel}:generateContent?key=${apiKey}`;
      const altRes = await fetch(altUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (altRes.ok) {
        res = altRes;
      }
    }

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini API error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    const candidate = data.candidates?.[0];
    const parts = candidate?.content?.parts || [];

    const funcCall = parts.find((p) => p.functionCall);
    if (funcCall) {
      const { name, args } = funcCall.functionCall;
      const output = await executeTool(name, args || {}, ctx);
      trace.push({ name, input: args, output });

      contents.push({ role: 'model', parts: [funcCall] });
      contents.push({
        role: 'user',
        parts: [
          {
            functionResponse: {
              name,
              response: output,
            },
          },
        ],
      });
      continue;
    }

    const textPart = parts.find((p) => p.text)?.text || '';
    const reply = guardReply(textPart.trim() || 'I am ready to help you with campus facilities. What do you need?', trace, session);
    return {
      reply,
      intent: session.intent,
      bookingChanged: ctx.bookingChanged,
      booking: ctx.booking,
    };
  }
  throw new Error('Gemini agent exceeded max iterations');
}

export async function runLlmAgent(args) {
  if (process.env.GEMINI_API_KEY) {
    return runGeminiAgent(args);
  }
  return runAnthropicAgent(args);
}

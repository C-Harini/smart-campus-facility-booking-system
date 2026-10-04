// Pure, dependency-free natural-language helpers used by the rule-based fallback agent.
// (When an LLM key is configured, the LLM does this work instead.)
import { addDays, isValidDate, toHHmm, toMinutes } from '../utils/time.js';

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12,
};
const MONTH_RX =
  '(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec)';

const RX_ISO = /\b(\d{4})-(\d{2})-(\d{2})\b/;
const RX_DMY = /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/;
const RX_DAY_MONTH = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:of\\s+)?${MONTH_RX}\\b(?:,?\\s*(\\d{4}))?`);
const RX_MONTH_DAY = new RegExp(`\\b${MONTH_RX}\\s*(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s*(\\d{4}))?`);

const pad = (n) => String(n).padStart(2, '0');

export function removeDateTokens(text) {
  return text.replace(RX_ISO, ' ').replace(RX_DMY, ' ').replace(RX_DAY_MONTH, ' ').replace(RX_MONTH_DAY, ' ');
}

/* ------------------------------------------------------------------- types */
const TYPE_RULES = [
  [/\b(computer\s*labs?|comp\s*labs?|labs?|computer\s*rooms?)\b/, 'Computer Lab'],
  [/\bseminar/, 'Seminar Hall'],
  [/\bauditorium/, 'Auditorium'],
  [/\bconference/, 'Conference Room'],
  [/\bmeeting\s*rooms?\b/, 'Meeting Room'],
  [/\b(class\s*rooms?|lecture\s*(hall|room)s?)\b/, 'Classroom'],
  [/\bbasketball/, 'Basketball Court'],
  [/\bvolleyball/, 'Volleyball Court'],
  [/\bindoor/, 'Indoor Hall'],
  [/\b(sports?\s*grounds?|playgrounds?|grounds?|fields?)\b/, 'Sports Ground'],
];

export function detectType(text) {
  const t = text.toLowerCase();
  for (const [rx, type] of TYPE_RULES) if (rx.test(t)) return type;
  return null;
}

/* ------------------------------------------------------------------- dates */
function buildDate(y, m, d, today, yearGiven) {
  let year = y;
  if (!yearGiven) {
    year = Number(today.slice(0, 4));
    let cand = `${year}-${pad(m)}-${pad(d)}`;
    if (isValidDate(cand) && cand < today) cand = `${year + 1}-${pad(m)}-${pad(d)}`;
    return isValidDate(cand) ? cand : null;
  }
  const cand = `${year}-${pad(m)}-${pad(d)}`;
  return isValidDate(cand) ? cand : null;
}

export function parseDate(text, today) {
  const t = text.toLowerCase();
  let m;
  if ((m = t.match(RX_ISO))) return isValidDate(m[0]) ? m[0] : null;
  if ((m = t.match(RX_DMY))) return buildDate(Number(m[3]), Number(m[2]), Number(m[1]), today, true);
  if ((m = t.match(RX_DAY_MONTH))) return buildDate(Number(m[3] || 0), MONTHS[m[2]], Number(m[1]), today, Boolean(m[3]));
  if ((m = t.match(RX_MONTH_DAY))) return buildDate(Number(m[3] || 0), MONTHS[m[1]], Number(m[2]), today, Boolean(m[3]));
  if (/\bday after tomorrow\b/.test(t)) return addDays(today, 2);
  if (/\b(tomorrow|tmrw|tomorow)\b/.test(t)) return addDays(today, 1);
  if (/\btoday\b/.test(t)) return today;
  if ((m = t.match(new RegExp(`\\b(next|this|coming|on)?\\s*(${WEEKDAYS.join('|')})\\b`)))) {
    const target = WEEKDAYS.indexOf(m[2]);
    const current = new Date(`${today}T00:00:00Z`).getUTCDay();
    let diff = (target - current + 7) % 7;
    if (m[1] === 'next' && diff === 0) diff = 7;
    return addDays(today, diff);
  }
  return null;
}

/* ------------------------------------------------------------------- times */
const to24 = (h, ap) => (ap === 'pm' ? (h % 12) + 12 : ap === 'am' ? h % 12 : h);
// Campus bookings happen in the daytime: bare 1-7 means PM, 8-11 means AM, 12 means noon.
const guess = (h) => (h >= 1 && h <= 7 ? h + 12 : h);
const cleanAp = (s) => (s ? s.replace(/\./g, '').toLowerCase() : undefined);
const hhmm = (h, m) => `${pad(h)}:${pad(m || 0)}`;

const PEOPLE_WORDS = '(?:students?|people|persons?|participants?|members?|attendees?|pax|guests?|staff|faculty)';

export function parseTimes(raw, { awaitingTime = false } = {}) {
  const text = removeDateTokens(raw.toLowerCase())
    .replace(/\bnoon\b/g, '12 pm')
    .replace(/\bmidday\b/g, '12 pm');
  const out = {};

  // Duration: "for 2 hours", "for an hour", "90 minutes"
  let d;
  if ((d = text.match(/\bfor\s+(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/))) out.durationMin = Math.round(parseFloat(d[1]) * 60);
  else if (/\bfor\s+(?:an?|one)\s+hour\b/.test(text)) out.durationMin = 60;
  else if ((d = text.match(/\b(\d+)\s*(?:minutes?|mins?)\b/))) out.durationMin = Number(d[1]);

  if (/\bmorning\b/.test(text)) out.timeOfDay = 'morning';
  else if (/\bafternoon\b/.test(text)) out.timeOfDay = 'afternoon';
  else if (/\bevening\b/.test(text)) out.timeOfDay = 'evening';

  // Range: "from 2 to 4 pm", "10am - 1pm", "between 3 and 5"
  const range = new RegExp(
    `(\\bfrom\\s+|\\bbetween\\s+|\\bat\\s+)?\\b(\\d{1,2})(?!\\d)(?::(\\d{2}))?\\s*(a\\.?m\\.?|p\\.?m\\.?)?\\s*(?:to|-|–|—|till|until|and)\\s*(\\d{1,2})(?!\\d)(?::(\\d{2}))?\\s*(a\\.?m\\.?|p\\.?m\\.?)?(?!\\s*${PEOPLE_WORDS})`
  );
  const r = text.match(range);
  if (r) {
    const [, kw, h1s, m1s, ap1raw, h2s, m2s, ap2raw] = r;
    const ap1 = cleanAp(ap1raw);
    const ap2 = cleanAp(ap2raw);
    const h1 = Number(h1s);
    const h2 = Number(h2s);
    const trusted = kw || ap1 || ap2 || m1s || m2s || awaitingTime;
    if (trusted && h1 <= 24 && h2 <= 24) {
      const min1 = Number(m1s || 0);
      const min2 = Number(m2s || 0);
      let s;
      let e;
      if (ap1 && ap2) {
        s = to24(h1, ap1);
        e = to24(h2, ap2);
      } else if (ap2) {
        e = to24(h2, ap2);
        s = to24(h1, ap2);
        if (s * 60 + min1 >= e * 60 + min2) s = to24(h1, ap2 === 'pm' ? 'am' : 'pm');
      } else if (ap1) {
        s = to24(h1, ap1);
        e = to24(h2, ap1);
        if (e * 60 + min2 <= s * 60 + min1) e = to24(h2, ap1 === 'am' ? 'pm' : 'am');
      } else {
        s = guess(h1);
        e = guess(h2);
        if (e * 60 + min2 <= s * 60 + min1 && e < 12) e += 12;
      }
      if (e <= 24 && s < 24 && e * 60 + min2 > s * 60 + min1) {
        out.startTime = hhmm(s, min1);
        out.endTime = e === 24 ? '23:59' : hhmm(e, min2);
        return out;
      }
    }
  }

  // Single time: "at 3 pm", "2:30pm", "at 15:00", or a bare number when we just asked for the time
  let s;
  if ((s = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)(?![a-z])/))) {
    out.startTime = hhmm(to24(Number(s[1]), cleanAp(s[3])), Number(s[2] || 0));
  } else if ((s = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/))) {
    out.startTime = hhmm(Number(s[1]), Number(s[2]));
  } else if ((s = text.match(/\bat\s*(\d{1,2})(?!\d)/))) {
    out.startTime = hhmm(guess(Number(s[1])), 0);
  } else if (awaitingTime && (s = text.trim().match(/^(\d{1,2})$/))) {
    out.startTime = hhmm(guess(Number(s[1])), 0);
  }
  if (out.startTime && out.durationMin) {
    const end = toMinutes(out.startTime) + out.durationMin;
    if (end <= 24 * 60 - 1) out.endTime = toHHmm(end);
  }
  return out;
}

/* ----------------------------------------------------------- other entities */
export function parseParticipants(text, awaiting = false) {
  const t = removeDateTokens(text.toLowerCase());
  let m = t.match(new RegExp(`(\\d{1,4})\\s*${PEOPLE_WORDS}`));
  if (m) return Number(m[1]);
  m = t.match(new RegExp(`${PEOPLE_WORDS}\\s*(?:of|:|=)\\s*(\\d{1,4})`));
  if (m) return Number(m[1]);
  if (awaiting && (m = t.match(/\b(\d{1,4})\b/))) return Number(m[1]);
  return null;
}

export function parseBookingId(text) {
  const m = text.match(/\bFAC\s?-?(\d{3,})\b/i);
  return m ? `FAC${m[1]}` : null;
}

const NOT_PURPOSE = /^(today|tomorrow|tmrw|next|this|day|the day|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d)/;

export function cleanPurpose(text) {
  let p = text.trim().replace(/^(it'?s|its|it is|the purpose is|purpose is|purpose:|for)\s+/i, '').replace(/[.!]+$/, '').trim();
  p = p.replace(/^(an?|the)\s+/i, '');
  if (!p) return null;
  p = p.slice(0, 120);
  return p.charAt(0).toUpperCase() + p.slice(1);
}

/** Purpose mentioned inside a longer sentence: "... for a department event with 150 students" */
export function parsePurposeInline(text) {
  const m = text.match(
    /\b(?:for|purpose(?:\s+is)?[:\s])\s+(?:an?\s+|the\s+|my\s+|our\s+)?([a-z][a-z' -]{2,50}?)(?=\s+(?:with|on|at|from|tomorrow|today|next|this|for|to|in|of|around|about)\b|[.,?!]|$)/i
  );
  if (!m) return null;
  const cand = m[1].trim();
  if (NOT_PURPOSE.test(cand.toLowerCase()) || detectType(cand)) return null;
  return cleanPurpose(cand);
}

export function parseOrdinal(text) {
  const t = text.toLowerCase();
  if (/\b(first|1st|former|earlier|earliest)\b/.test(t)) return 0;
  if (/\b(second|2nd|latter)\b/.test(t)) return 1;
  if (/\b(third|3rd)\b/.test(t)) return 2;
  if (/\b(last)\b/.test(t)) return -1;
  return null;
}

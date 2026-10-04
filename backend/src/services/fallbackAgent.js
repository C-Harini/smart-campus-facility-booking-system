/**
 * Natural-Language Campus Booking Agent (Rule-based & pattern NLP).
 * Handles all Student and Admin queries intelligently and conversationally.
 * Fully supports all admin management operations: pending bookings, approvals (individual & bulk),
 * user directory inquiries, who booked what, facility counts, adding/modifying/deactivating facilities,
 * and system statistics.
 */
import Facility, { FACILITY_TYPES, WEEK_DAYS } from '../models/Facility.js';
import Booking from '../models/Booking.js';
import User from '../models/User.js';
import * as svc from './bookingService.js';
import { BookingError } from '../utils/errors.js';
import { briefBooking, escapeRegex } from './agentTools.js';
import { nowInTz, format12, formatDateLong, formatRange, toMinutes, toHHmm } from '../utils/time.js';
import {
  detectType, parseDate, parseTimes, parseParticipants, parseBookingId,
  cleanPurpose, parsePurposeInline, parseOrdinal,
} from '../nlp/parser.js';

const YES = /^\s*(yes|yep|yeah|yup|y|sure|ok|okay|confirm|confirmed|go ahead|book it|do it|please do|proceed)\b/i;
const NO = /^\s*(no|nope|nah|n|don'?t|do not|stop|abort)\b/i;
const ABORT = /^\s*(cancel|stop|never\s?mind|reset|start over|forget it|exit)\W*$/i;
const FLOW_INTENT = {
  book: 'BOOK_FACILITY',
  check: 'CHECK_AVAILABILITY',
  slots: 'SHOW_AVAILABLE_SLOTS',
  cancel: 'CANCEL_BOOKING',
  status: 'BOOKING_STATUS',
  admin_decide: 'ADMIN_DECIDE',
  admin_add: 'ADMIN_ADD_FACILITY',
};
const TIME_WINDOWS = { morning: ['06:00', '12:00'], afternoon: ['12:00', '17:00'], evening: ['16:00', '21:00'] };
const fmtRanges = (rs) => rs.map(formatRange).join(', ');
const describe = (b) => `**${b.bookingId}** – ${b.facility?.name}, ${formatDateLong(b.date)}, ${formatRange(b)} [${b.status}]`;

export function detectIntent(lower, role = 'student') {
  const norm = lower.replace(/\bfaculty\b/g, 'facility').replace(/\bfaculties\b/g, 'facilities');

  if (role === 'admin') {
    // 1. Pending approvals
    if (/\b(pending|awaiting|waiting)\b/.test(norm) || /\bwho\s+is\s+waiting\b/.test(norm) || /\b(show|view|check|get|any)\s+(all\s+)?pending\b/.test(norm) || /\bwhat\s+(is|are)\s+pending\b/.test(norm)) return 'ADMIN_PENDING';

    // 2. Decide (approve / reject)
    if (/\b(approve|accept|confirm|reject|decline|disapprove|deny)\b/i.test(norm)) return 'ADMIN_DECIDE';

    // 3. User directory inquiries
    if (/\b(users?|students?|registered\s+users?|accounts?|who\s+is\s+registered|user\s+list|student\s+list)\b/i.test(norm) && !/\b(book|free|available|vacant)\b/.test(norm)) return 'ADMIN_USERS';

    // 4. Who booked / all bookings search
    if (/\b(who\s+booked|who\s+is\s+using|all\s+bookings|today'?s\s+bookings|bookings\s+today|bookings\s+tomorrow|list\s+bookings|show\s+bookings)\b/i.test(norm) || /\bwho\s+(has|have)\s+reserved\b/.test(norm) || /\bbookings?\s+(on|for|during)\b/.test(norm)) return 'ADMIN_BOOKINGS_SEARCH';

    // 5. Facility counts
    if (/\bhow\s+many\s+(facilities|rooms|labs|halls|venues|computer\s+labs|seminar\s+halls|classrooms|auditoriums)\b/i.test(norm)) return 'ADMIN_FACILITY_COUNT';

    // 6. Stats & overview
    if (/\b(admin\s+stats|campus\s+stats|system\s+stats|reports?|overview|dashboard|analytics)\b/.test(norm) || (/\bstats\b/.test(norm) && !/\bstatus\b/.test(norm))) return 'ADMIN_STATS';

    // 7. Add facility (super flexible)
    if (/\b(add|create|new|insert|build|set\s*up)\b.*\b(facility|facilities|room|hall|lab|venue|place|center|ground|court)\b/i.test(norm) || /\b(add|create)\s+one\b/i.test(norm) || /\bcan\s*(you|u)\s*add\b/i.test(norm)) return 'ADMIN_ADD_FACILITY';

    // 8. Delete / Deactivate facility
    if (/\b(delete|remove|deactivate|disable|trash|destroy|close|shut\s*down)\b.*\b(facility|facilities|room|hall|lab|venue)\b/i.test(norm) || /\b(restore|activate|enable|reopen)\b.*\b(facility|facilities|room|hall|lab|venue)\b/i.test(norm) || /\b(deactivate|restore|delete|remove)\s+[a-z0-9 ]+\b/i.test(norm)) return 'ADMIN_DELETE_FACILITY';

    // 9. Modify facility
    if (/\b(modify|update|edit|change|alter|set|adjust|rename)\b.*\b(facility|facilities|room|hall|lab|venue|capacity|timing|hours|location)\b/i.test(norm) || /\b(capacity|timing|hours|location)\s*(of|for)\s+[a-z0-9 ]+\b/i.test(norm)) return 'ADMIN_MODIFY_FACILITY';
  }

  // Suggestion & recommendations (student or admin)
  if (/\b(suggest|recommend|recommendation|what should i book|which facility should i book|best facility for|what facility is best)\b/.test(norm)) return 'SUGGEST_FACILITY';

  // Facilities listing
  if (/\b(list|show|all|view)\s+(all\s+)?facilities\b|\bavailable\s+facilities\b|\bwhat facilities can i book\b|\bshow\s+all\s+rooms\b/.test(norm)) return 'LIST_FACILITIES';

  if (/\bcancel/.test(norm)) return 'CANCEL_BOOKING';
  if (/\bstatus\b/.test(norm)) return 'BOOKING_STATUS';
  if (/\b(my|upcoming|all)\b.*\b(bookings?|reservations?)\b|\bshow\b.*\bbookings?\b/.test(norm)) return 'MY_BOOKINGS';
  if (/\bslots?\b|\bavailable times?\b|\bfree times?\b/.test(norm)) return 'SHOW_AVAILABLE_SLOTS';
  if (/\b(free|available|availability|vacant)\b/.test(norm)) return 'CHECK_AVAILABILITY';
  if (/\b(what|which)\s+(facilities|places|rooms|halls|venues|can i)\b|\bwhat can i book\b|\bhelp\b|^\s*(hi|hello|hey)\b/.test(norm)) return 'GENERAL_QUERY';
  if (/\bdoes\b|\bdo you have\b|\b(have|has)\b.*\?|\b(equipment|projector|capacity|how many|where is|located|location|details|microphone|wifi)\b|\btell me about\b/.test(norm)) return 'FACILITY_INFORMATION';
  if (/\b(book|need|want|reserve|looking for|require|arrange|schedule)\b/.test(norm)) return 'BOOK_FACILITY';
  return null;
}

async function matchFacilityByName(lower, includeInactive = false) {
  const filter = includeInactive ? {} : { status: 'Active' };
  const all = await Facility.find(filter).select('name type status location capacity openingTime closingTime equipment').lean();
  const hit = all.sort((a, b) => b.name.length - a.name.length).find((f) => new RegExp(`\\b${escapeRegex(f.name.toLowerCase())}\\b`).test(lower));
  return hit ? Facility.findById(hit._id) : null;
}

async function candidates(ctx) {
  if (ctx.facilityId) {
    const f = await Facility.findById(ctx.facilityId);
    return f ? [f] : [];
  }
  if (!ctx.facilityType) return [];
  return Facility.find({ type: ctx.facilityType, status: 'Active' }).sort({ capacity: 1 });
}

const clip = (ranges, from, to) =>
  ranges
    .map((r) => ({ startTime: r.startTime > from ? r.startTime : from, endTime: r.endTime < to ? r.endTime : to }))
    .filter((r) => r.startTime < r.endTime);

/* ---------------------------------------------------------- entity merging */
async function mergeEntities(ctx, message, today) {
  const awaiting = ctx.awaiting;
  if (awaiting === 'purpose') {
    ctx.purpose = cleanPurpose(message) || ctx.purpose;
    return;
  }
  const lower = message.toLowerCase();
  const fac = await matchFacilityByName(lower);
  const type = detectType(message);
  if (fac) Object.assign(ctx, { facilityId: String(fac._id), facilityName: fac.name, facilityType: fac.type });
  else if (type && type !== ctx.facilityType) {
    ctx.facilityType = type;
    delete ctx.facilityId;
    delete ctx.facilityName;
  }
  const d = parseDate(message, today);
  if (d) ctx.date = d;

  const tm = parseTimes(message, { awaitingTime: awaiting === 'time' || awaiting === 'endTime' });
  if (awaiting === 'endTime' && ctx.startTime && tm.startTime && !tm.endTime) {
    ctx.endTime = tm.startTime;
  } else if (tm.startTime && tm.endTime) {
    ctx.startTime = tm.startTime;
    ctx.endTime = tm.endTime;
  } else if (tm.startTime) {
    ctx.startTime = tm.startTime;
    delete ctx.endTime;
  }
  if (tm.timeOfDay) ctx.timeOfDay = tm.timeOfDay;

  if (awaiting === 'time' && Array.isArray(ctx.offered) && ctx.offered.length) {
    const idx = parseOrdinal(message);
    if (idx !== null) {
      const pick = ctx.offered.at(idx);
      if (pick) Object.assign(ctx, { startTime: pick.startTime, endTime: pick.endTime });
    }
  }
  const p = parseParticipants(message, awaiting === 'participants');
  if (p) ctx.participants = p;
  if (ctx.flow === 'book' && !ctx.purpose) {
    const inline = parsePurposeInline(message);
    if (inline) ctx.purpose = inline;
  }
}

/* ------------------------------------------------------------ flow: booking */
function ask(ctx, awaiting, text) {
  ctx.awaiting = awaiting;
  return text;
}

const summary = (ctx, f) =>
  `Please confirm your booking:\n**${f.name}** (${f.location})\n📅 ${formatDateLong(ctx.date)}\n🕑 ${formatRange(ctx)}\n👥 ${ctx.participants} participants\n📝 ${ctx.purpose}\nNote: All bookings require admin approval and will start in Pending status.\nShall I confirm the booking? (yes / no)`;

async function bookingStep(ctx, user) {
  if (!ctx.facilityType && !ctx.facilityId) return ask(ctx, 'type', 'Sure! What type of facility would you prefer? (classroom, computer lab, seminar hall, auditorium, conference room, meeting room, sports ground, basketball/volleyball court or indoor hall)');
  if (!ctx.date) return ask(ctx, 'date', 'What date would you like to book it?');
  if (!ctx.startTime) {
    return ask(ctx, 'time', ctx.timeOfDay
      ? `What exact time in the ${ctx.timeOfDay} would you like? (for example 2 PM to 4 PM)`
      : 'What time would you like to book it? (for example 2 PM to 4 PM)');
  }
  if (!ctx.endTime) return ask(ctx, 'endTime', `Starting at ${format12(ctx.startTime)} – until what time?`);
  if (!ctx.participants) return ask(ctx, 'participants', 'How many participants will attend?');

  const list = await candidates(ctx);
  if (!list.length) {
    const name = ctx.facilityType || 'facility';
    Object.keys(ctx).forEach((k) => delete ctx[k]);
    return `Sorry, I couldn't find an active ${name} in the system. Try another facility type.`;
  }
  const failures = [];
  for (const f of list) {
    const r = await svc.checkRange(f, { date: ctx.date, startTime: ctx.startTime, endTime: ctx.endTime, participants: ctx.participants });
    if (r.available) {
      Object.assign(ctx, { facilityId: String(f._id), facilityName: f.name, facilityType: f.type });
      if (!ctx.purpose) {
        return ask(ctx, 'purpose', `${f.name} is available on ${formatDateLong(ctx.date)} from ${formatRange(ctx)} and holds up to ${f.capacity} people. What is the purpose of the booking?`);
      }
      return ask(ctx, 'confirm', `${f.name} is available and holds up to ${f.capacity} people.\n${summary(ctx, f)}`);
    }
    failures.push({ f, r });
  }
  return explainFailure(ctx, failures);
}

function explainFailure(ctx, failures) {
  const conflict = failures.find((x) => x.r.code === 'CONFLICT');
  const pick = conflict || failures[failures.length - 1];
  const { f, r } = pick;
  ctx.offered = undefined;
  if (r.code === 'CONFLICT') {
    if (r.freeRanges.length) {
      ctx.offered = r.freeRanges;
      delete ctx.startTime;
      delete ctx.endTime;
      return ask(ctx, 'time', `That time is already booked. ${f.name} is available ${fmtRanges(r.freeRanges)} on ${formatDateLong(ctx.date)}. Which would you prefer?`);
    }
    delete ctx.date; delete ctx.startTime; delete ctx.endTime;
    return ask(ctx, 'date', `${f.name} has no free slots on that day. Would another date work?`);
  }
  if (['PAST', 'CLOSED_DAY', 'INVALID_DATE'].includes(r.code)) { delete ctx.date; return ask(ctx, 'date', `${r.reason} Which other date would you like?`); }
  if (r.code === 'CAPACITY' || r.code === 'INVALID_PARTICIPANTS') { delete ctx.participants; return ask(ctx, 'participants', `${r.reason} How many participants will attend?`); }
  delete ctx.startTime; delete ctx.endTime;
  return ask(ctx, 'time', `${r.reason} What time would you like instead?`);
}

async function doBooking(ctx, user, out) {
  try {
    const b = await svc.createBooking({
      userId: user._id, facilityId: ctx.facilityId, date: ctx.date, startTime: ctx.startTime,
      endTime: ctx.endTime, purpose: ctx.purpose, participants: ctx.participants,
    });
    out.bookingChanged = true;
    out.booking = briefBooking(b);
    const facilityName = b.facility?.name || ctx.facilityName || 'Facility';
    const msg = b.status === 'Pending'
      ? `Your booking request has been submitted and is awaiting admin approval. Booking ID: **${b.bookingId}** (Pending).\n${facilityName} · ${formatDateLong(b.date)} · ${formatRange(b)}`
      : `Booking confirmed successfully! Your booking ID is **${b.bookingId}**.\n${facilityName} · ${formatDateLong(b.date)} · ${formatRange(b)}`;
    Object.keys(ctx).forEach((k) => delete ctx[k]);
    return msg;
  } catch (e) {
    if (!(e instanceof BookingError)) throw e;
    if (e.code === 'CONFLICT') {
      const f = await Facility.findById(ctx.facilityId);
      return explainFailure(ctx, [{ f, r: { code: 'CONFLICT', freeRanges: e.extra.freeRanges || [] } }]);
    }
    return `Sorry, the booking could not be completed: ${e.message}`;
  }
}

/* ------------------------------------------------------- flow: check / slots */
async function checkStep(ctx) {
  if (!ctx.facilityType && !ctx.facilityId) return ask(ctx, 'type', 'Which facility would you like me to check?');
  if (!ctx.date) return ask(ctx, 'date', 'For which date?');
  const list = await candidates(ctx);
  if (!list.length) { Object.keys(ctx).forEach((k) => delete ctx[k]); return "I couldn't find that facility."; }

  const hasTime = Boolean(ctx.startTime);
  if (hasTime && !ctx.endTime) ctx.endTime = toHHmm(toMinutes(ctx.startTime) + (list[0].slotDuration || 60));
  const lines = [];
  let firstFree = null;
  for (const f of list.slice(0, 5)) {
    if (hasTime) {
      const r = await svc.checkRange(f, { date: ctx.date, startTime: ctx.startTime, endTime: ctx.endTime });
      if (r.available) { lines.push(`✅ ${f.name} is free ${formatRange(ctx)} on ${formatDateLong(ctx.date)}.`); firstFree ||= f; }
      else lines.push(`❌ ${r.reason}${r.freeRanges?.length ? ` Free: ${fmtRanges(r.freeRanges)}.` : ''}`);
    } else {
      const a = await svc.getAvailability(f, ctx.date);
      let ranges = a.freeRanges;
      if (ctx.timeOfDay) ranges = clip(ranges, ...TIME_WINDOWS[ctx.timeOfDay]);
      if (!a.open) lines.push(`❌ ${a.reason}`);
      else if (!ranges.length) lines.push(`❌ ${f.name} has no free slots${ctx.timeOfDay ? ` in the ${ctx.timeOfDay}` : ''} on ${formatDateLong(ctx.date)}.`);
      else { lines.push(`✅ ${f.name}: ${fmtRanges(ranges)}`); firstFree ||= { f, ranges }; }
    }
  }
  const head = ctx.flow === 'slots' ? `Available slots on ${formatDateLong(ctx.date)}:` : `Here's what I found for ${formatDateLong(ctx.date)}:`;
  let text = `${head}\n${lines.join('\n')}`;

  if (firstFree) {
    const f = firstFree.f || firstFree;
    ctx.flow = 'book';
    if (hasTime) {
      Object.assign(ctx, { facilityId: String(f._id), facilityName: f.name });
      text += '\nWould you like to book it? (yes / no)';
      return ask(ctx, 'offer', text);
    }
    delete ctx.timeOfDay;
    if (list.length === 1) Object.assign(ctx, { facilityId: String(f._id), facilityName: f.name });
    text += '\nTell me the time you want (e.g. "2 PM to 4 PM") and I can book it.';
    return ask(ctx, 'time', text);
  }
  Object.keys(ctx).forEach((k) => delete ctx[k]);
  return text;
}

/* ------------------------------------------------------------ flow: cancel */
async function cancelStep(ctx, user, message, out) {
  if (ctx.awaiting === 'confirm' && ctx.cancelId) {
    if (YES.test(message)) {
      try {
        const b = await svc.cancelBooking(ctx.cancelId, user);
        out.bookingChanged = true;
        Object.keys(ctx).forEach((k) => delete ctx[k]);
        return `Done – booking **${b.bookingId}** has been cancelled.`;
      } catch (e) {
        if (!(e instanceof BookingError)) throw e;
        Object.keys(ctx).forEach((k) => delete ctx[k]);
        return `I couldn't cancel it: ${e.message}`;
      }
    }
    if (NO.test(message)) { Object.keys(ctx).forEach((k) => delete ctx[k]); return 'Okay, I have kept your booking as it is.'; }
    return 'Please reply "yes" to cancel the booking or "no" to keep it.';
  }
  const id = parseBookingId(message);
  const confirmFor = async (ref) => {
    try {
      const b = svc.serializeBooking(await svc.getBookingForUser(ref, user));
      if (!svc.ACTIVE_STATUSES.includes(b.status)) { Object.keys(ctx).forEach((k) => delete ctx[k]); return `Booking ${b.bookingId} is already ${b.status.toLowerCase()}, so it can't be cancelled.`; }
      ctx.flow = 'cancel'; ctx.cancelId = b.bookingId;
      return ask(ctx, 'confirm', `Do you want to cancel ${describe(b)}? (yes / no)`);
    } catch (e) {
      if (!(e instanceof BookingError)) throw e;
      Object.keys(ctx).forEach((k) => delete ctx[k]);
      return `I couldn't find a booking ${ref} on your account.`;
    }
  };
  if (id) return confirmFor(id);

  let list = await svc.getUserBookings(user._id, 'upcoming');
  const type = detectType(message);
  if (type) list = list.filter((b) => b.facility?.type === type);
  const nm = await matchFacilityByName(message.toLowerCase());
  if (nm) list = list.filter((b) => String(b.facilityId) === String(nm._id));
  if (!list.length) { Object.keys(ctx).forEach((k) => delete ctx[k]); return "You don't have any upcoming bookings that match."; }
  if (list.length === 1) return confirmFor(list[0].bookingId);
  ctx.flow = 'cancel';
  return ask(ctx, 'bookingId', `Which one would you like to cancel? Reply with the booking ID:\n${list.slice(0, 8).map(describe).join('\n')}`);
}

/* ---------------------------------------------------- flow: ADMIN PENDING */
async function adminPendingStep(ctx, user, message, today) {
  if (user.role !== 'admin') return 'Viewing pending booking requests is only available for campus administrators.';

  const wantsToday = /\btoday\b/i.test(message);
  const parsedDate = wantsToday ? today : parseDate(message, today);
  const filter = { status: 'Pending' };
  if (parsedDate) filter.date = parsedDate;

  const list = await Booking.find(filter)
    .populate('facilityId', 'name type location capacity')
    .populate('userId', 'name email department')
    .sort({ date: 1, startTime: 1 })
    .limit(20);

  if (!list.length) {
    return parsedDate
      ? `There are no pending booking requests for **${formatDateLong(parsedDate)}**.`
      : 'There are currently no pending booking requests in the system. Everything is up to date!';
  }

  const items = list.map((b, i) => {
    const fName = b.facilityId?.name || 'Unknown facility';
    const loc = b.facilityId?.location ? ` (${b.facilityId.location})` : '';
    const uName = b.userId?.name || 'User';
    const email = b.userId?.email ? ` (${b.userId.email})` : '';
    const time = `${format12(b.startTime)} – ${format12(b.endTime)}`;
    return `${i + 1}. **${b.bookingId}** – ${uName}${email}\n   🏛️ ${fName}${loc}\n   📅 ${formatDateLong(b.date)} · 🕑 ${time} · 👥 ${b.participants} pax\n   📝 Purpose: ${b.purpose}`;
  });

  return `📋 **Pending Bookings (${list.length}${parsedDate ? ` on ${formatDateLong(parsedDate)}` : ' total'}):**\n\n${items.join('\n\n')}\n\n👉 *To take action, simply type:*\n• "Approve ${list[0].bookingId}"\n• "Reject ${list[0].bookingId} with note <reason>"`;
}

/* ---------------------------------------------------- flow: ADMIN DECIDE */
async function adminDecideStep(ctx, user, message, out) {
  if (user.role !== 'admin') return 'Approving or rejecting bookings is restricted to campus administrators.';

  const isReject = /\b(reject|decline|disapprove|deny)\b/i.test(message) || ctx.action === 'reject';
  const isApproveAll = /\ball\b/i.test(message) && !isReject;

  // Bulk approval: "approve all" / "approve all pending"
  if (isApproveAll) {
    const pendings = await Booking.find({ status: 'Pending' });
    if (!pendings.length) return 'There are currently no pending bookings in the system to approve.';
    for (const b of pendings) {
      await svc.decideBooking(b.bookingId, 'Confirmed', 'Bulk approved by administrator');
    }
    out.bookingChanged = true;
    return `✅ Successfully approved all **${pendings.length}** pending bookings: ${pendings.map((b) => `**${b.bookingId}**`).join(', ')}.`;
  }

  const id = parseBookingId(message) || ctx.decideId;

  if (!id) {
    const pendingList = await Booking.find({ status: 'Pending' }).limit(5);
    if (!pendingList.length) {
      Object.keys(ctx).forEach((k) => delete ctx[k]);
      return 'There are currently no pending bookings in the system to approve or reject.';
    }
    ctx.flow = 'admin_decide';
    ctx.action = isReject ? 'reject' : 'approve';
    return ask(ctx, 'decideId', `Which booking ID would you like to ${ctx.action}? Pending requests: ${pendingList.map((b) => `**${b.bookingId}**`).join(', ')}`);
  }

  const noteMatch = message.match(/(?:with\s+note|reason|note|because)[:\s]+([^.]+)/i);
  const note = noteMatch ? noteMatch[1].trim() : (ctx.adminNote || '');

  const decision = isReject ? 'Rejected' : 'Confirmed';
  try {
    const b = await svc.decideBooking(id, decision, note);
    out.bookingChanged = true;
    Object.keys(ctx).forEach((k) => delete ctx[k]);
    if (decision === 'Confirmed') {
      return `✅ Booking **${b.bookingId}** for ${b.facility?.name} on ${formatDateLong(b.date)} has been **APPROVED**!`;
    } else {
      return `❌ Booking **${b.bookingId}** has been **REJECTED**${b.adminNote ? ` (Note: "${b.adminNote}")` : ''}. The slot has been released.`;
    }
  } catch (e) {
    Object.keys(ctx).forEach((k) => delete ctx[k]);
    if (e instanceof BookingError) {
      if (e.code === 'NOT_FOUND') {
        const pending = await Booking.find({ status: 'Pending' }).limit(5);
        const pStr = pending.length ? `\nCurrently pending requests: ${pending.map((x) => `**${x.bookingId}**`).join(', ')}` : '\nThere are currently no pending requests.';
        return `Booking **${id}** was not found.${pStr}`;
      }
      return `Could not process booking **${id}**: ${e.message}`;
    }
    return `Could not process booking **${id}**: ${e.message || 'Server error'}`;
  }
}

/* ---------------------------------------------------- flow: ADMIN STATS */
async function adminStatsStep(user) {
  if (user.role !== 'admin') return 'System reports and statistics are restricted to campus administrators.';
  await svc.refreshCompleted();
  const [totalFacilities, activeFacilities, totalUsers, byStatus] = await Promise.all([
    Facility.countDocuments(),
    Facility.countDocuments({ status: 'Active' }),
    User.countDocuments(),
    Booking.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
  ]);
  const c = Object.fromEntries(byStatus.map((s) => [s._id, s.n]));
  const totalBookings = byStatus.reduce((a, s) => a + s.n, 0);
  const todayBookings = await Booking.countDocuments({
    date: nowInTz().date,
    status: { $in: ['Pending', 'Confirmed'] },
  });

  return `📊 **Campus Booking System Stats:**
• 🏛️ **Facilities**: ${activeFacilities} active (${totalFacilities} total)
• 👥 **Registered Users**: ${totalUsers}
• 📅 **Total Bookings**: ${totalBookings}
   - ⏳ Pending: **${c.Pending || 0}**
   - ✅ Confirmed: **${c.Confirmed || 0}**
   - 🏁 Completed: **${c.Completed || 0}**
   - 🚫 Cancelled: **${c.Cancelled || 0}**
   - ❌ Rejected: **${c.Rejected || 0}**
• 🌟 **Active Bookings Today**: **${todayBookings}**`;
}

/* ---------------------------------------------------- flow: ADMIN USERS */
async function adminUsersStep() {
  const [total, students, admins, recent] = await Promise.all([
    User.countDocuments(),
    User.countDocuments({ role: 'student' }),
    User.countDocuments({ role: 'admin' }),
    User.find().sort({ createdAt: -1 }).limit(10).lean(),
  ]);

  const list = recent.map((u, i) => `   ${i + 1}. **${u.name}** (${u.email}) – Role: *${u.role}*${u.department ? `, Dept: ${u.department}` : ''}`).join('\n');
  return `👥 **Campus User Directory:**\n• Total Registered Users: **${total}**\n• 🎓 Students: **${students}**\n• 🛡️ Administrators: **${admins}**\n\nRecent Users:\n${list}`;
}

/* --------------------------------------- flow: ADMIN BOOKINGS SEARCH */
async function adminBookingsSearchStep(message, today) {
  await svc.refreshCompleted();
  const lower = message.toLowerCase();
  const fac = await matchFacilityByName(lower, true);
  const type = detectType(message);
  const wantsToday = /\btoday\b/i.test(message);
  const d = wantsToday ? today : parseDate(message, today);

  const filter = {};
  if (fac) filter.facilityId = fac._id;
  if (d) filter.date = d;

  if (/\bpending\b/i.test(message)) filter.status = 'Pending';
  else if (/\bcancelled\b/i.test(message)) filter.status = 'Cancelled';
  else if (/\brejected\b/i.test(message)) filter.status = 'Rejected';
  else filter.status = { $in: ['Pending', 'Confirmed', 'Completed'] };

  let list = await Booking.find(filter)
    .populate('facilityId', 'name type location')
    .populate('userId', 'name email department')
    .sort({ date: -1, startTime: -1 })
    .limit(12);

  if (type && !fac) {
    list = list.filter((b) => b.facilityId?.type === type);
  }

  if (!list.length) {
    const target = fac ? fac.name : type ? type : 'the campus';
    const timeStr = d ? ` on ${formatDateLong(d)}` : '';
    return `No matching bookings found for ${target}${timeStr}.`;
  }

  const items = list.map((b, i) => {
    const uName = b.userId?.name || 'Unknown User';
    const dept = b.userId?.department ? ` (${b.userId.department})` : '';
    const fName = b.facilityId?.name || 'Facility';
    const time = `${format12(b.startTime)} – ${format12(b.endTime)}`;
    return `${i + 1}. **${b.bookingId}** [${b.status}] – **${fName}**\n   👤 Booked by: ${uName}${dept} (${b.userId?.email || 'N/A'})\n   📅 Date: ${formatDateLong(b.date)} (${time}) · 👥 ${b.participants} pax\n   📝 Purpose: ${b.purpose}`;
  });

  return `📋 **Bookings Search Results (${list.length}):**\n\n${items.join('\n\n')}`;
}

/* --------------------------------------- flow: ADMIN FACILITY COUNT */
async function adminFacilityCountStep(message) {
  const type = detectType(message);
  if (type) {
    const facs = await Facility.find({ type }).sort({ name: 1 }).lean();
    const active = facs.filter((f) => f.status === 'Active').length;
    const totalCap = facs.reduce((sum, f) => sum + (f.capacity || 0), 0);
    const names = facs.map((f) => `**${f.name}** (Cap: ${f.capacity}, ${f.location})`).join(', ');
    return `🏛️ **${type}s Summary:**\n• Total: **${facs.length}** (${active} active)\n• Total Seating Capacity: **${totalCap}**\n• Facilities: ${names || 'None'}`;
  }

  const [total, active, inactive] = await Promise.all([
    Facility.countDocuments(),
    Facility.countDocuments({ status: 'Active' }),
    Facility.countDocuments({ status: 'Inactive' }),
  ]);
  const types = await Facility.distinct('type');
  return `🏛️ **Campus Facility Overview:**\n• Total Facilities: **${total}**\n• 🟢 Active: **${active}**\n• 🔴 Inactive: **${inactive}**\n• Categories (${types.length}): ${types.join(', ')}`;
}

/* ------------------------------------------------ flow: LIST FACILITIES */
async function listFacilitiesStep(user, message) {
  const isAdmin = user.role === 'admin';
  const showAll = isAdmin && /\b(all|inactive)\b/i.test(message);
  const filter = showAll ? {} : { status: 'Active' };
  const type = detectType(message);
  if (type) filter.type = type;

  const list = await Facility.find(filter).sort({ type: 1, name: 1 });
  if (!list.length) return 'No facilities found matching your criteria.';

  if (isAdmin) {
    const lines = list.map((f) => {
      const tag = f.status === 'Active' ? '🟢 Active' : '🔴 Inactive';
      const apr = f.requiresApproval ? ' [Approval Req]' : '';
      return `• **${f.name}** (${f.type}) – ${f.location} | Cap: ${f.capacity} | ${tag}${apr}`;
    });
    return `🏛️ **Campus Facilities (${list.length}):**\n${lines.join('\n')}\n\n*Tip: Say "Add facility...", "Modify facility...", or "Deactivate facility..." to manage.*`;
  }

  const groups = {};
  for (const f of list) {
    groups[f.type] = groups[f.type] || [];
    groups[f.type].push(f);
  }
  const sections = Object.entries(groups).map(([t, facs]) => {
    const items = facs.map((f) => `  - **${f.name}** (Cap: ${f.capacity}, ${f.location})`).join('\n');
    return `**${t}s**:\n${items}`;
  });
  return `🏛️ **Available Campus Facilities:**\n\n${sections.join('\n\n')}\n\n*Say "Tell me about <facility>" or "Suggest a facility for <N> people" to get started!*`;
}

/* ---------------------------------------------- flow: SUGGEST FACILITY */
async function suggestFacilityStep(ctx, message, today) {
  const pCount = parseParticipants(message) || ctx.participants || 30;
  const type = detectType(message);
  const eqTokens = ['projector', 'ac', 'computers', 'wifi', 'microphone', 'mic', 'whiteboard', 'sound system', 'stage lighting']
    .filter((w) => new RegExp(`\\b${w}\\b`, 'i').test(message));

  const filter = { status: 'Active', capacity: { $gte: pCount } };
  if (type) filter.type = type;
  let candidatesList = await Facility.find(filter).sort({ capacity: 1 });
  if (!candidatesList.length) {
    candidatesList = await Facility.find({ status: 'Active' }).sort({ capacity: -1 }).limit(5);
  }

  const d = parseDate(message, today);
  const tm = parseTimes(message);

  const scored = [];
  for (const f of candidatesList) {
    let score = 0;
    const fEq = f.equipment.map((e) => e.toLowerCase());
    for (const eq of eqTokens) {
      const match = eq === 'mic' ? 'microphone' : eq;
      if (fEq.some((e) => e.includes(match))) score += 3;
    }
    const capDiff = f.capacity - pCount;
    if (capDiff >= 0 && capDiff <= 30) score += 4;
    else if (capDiff > 30 && capDiff <= 80) score += 2;
    else if (capDiff > 80) score -= 1;

    let availStr = '';
    if (d && tm.startTime && tm.endTime) {
      const r = await svc.checkRange(f, { date: d, startTime: tm.startTime, endTime: tm.endTime, participants: pCount });
      availStr = r.available ? ` | ✅ Free ${formatRange({ startTime: tm.startTime, endTime: tm.endTime })}` : ` | ❌ Busy (${r.reason})`;
    }
    scored.push({ f, score, availStr });
  }

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, 3);
  if (!top.length) return 'Sorry, I could not find a suitable facility for your requirements. Please check our facility list.';

  const lines = top.map((item, i) => {
    const { f, availStr } = item;
    const eq = f.equipment.length ? `Equipment: ${f.equipment.join(', ')}` : 'Standard equipment';
    return `${i + 1}. **${f.name}** (${f.type})\n   📍 Location: ${f.location}\n   👥 Capacity: ${f.capacity} (ideal for ${pCount} people)\n   🛠️ ${eq}${availStr}`;
  });

  return `💡 **Facility Recommendations for ${pCount} participants${eqTokens.length ? ` with ${eqTokens.join(', ')}` : ''}:**\n\n${lines.join('\n\n')}\n\n👉 *To book, simply say: "Book ${top[0].f.name} tomorrow at 2 PM for ${pCount} people"!*`;
}

/* --------------------------------------------- flow: ADMIN ADD FACILITY */
async function adminAddFacilityStep(ctx, user, message) {
  if (user.role !== 'admin') return 'Adding facilities is restricted to administrators.';
  const lower = message.toLowerCase();

  if (ctx.awaiting === 'add_name') {
    ctx.name = message.trim();
    ctx.awaiting = 'add_type';
    return `Great! What is the facility type? Options: ${FACILITY_TYPES.join(', ')}`;
  }
  if (ctx.awaiting === 'add_type') {
    const t = detectType(message) || FACILITY_TYPES.find((x) => x.toLowerCase() === lower);
    if (!t) return `Please choose a valid type: ${FACILITY_TYPES.join(', ')}`;
    ctx.type = t;
    ctx.awaiting = 'add_capacity';
    return `Got it, ${t}. What is the seating capacity?`;
  }
  if (ctx.awaiting === 'add_capacity') {
    const cap = parseInt(message.match(/\d+/)?.[0] || '0', 10);
    if (cap <= 0) return 'Please specify a valid capacity (e.g. 50).';
    ctx.capacity = cap;
    ctx.awaiting = 'add_location';
    return `Capacity set to ${cap}. Where is it located on campus? (e.g. "Main Block - 3rd Floor")`;
  }
  if (ctx.awaiting === 'add_location') {
    ctx.location = message.trim();
    try {
      const f = await Facility.create({
        name: ctx.name,
        type: ctx.type,
        location: ctx.location,
        capacity: ctx.capacity,
        description: `${ctx.type} facility located in ${ctx.location}.`,
        equipment: ['Projector', 'AC'],
        openingTime: '09:00',
        closingTime: '18:00',
        availableDays: WEEK_DAYS.slice(0, 6),
        slotDuration: 60,
        minDuration: 60,
        maxDuration: 240,
        requiresApproval: true,
        status: 'Active',
      });
      const resName = f.name;
      Object.keys(ctx).forEach((k) => delete ctx[k]);
      return `🎉 Facility **${resName}** has been successfully added to the system!\n• Type: ${f.type}\n• Location: ${f.location}\n• Capacity: ${f.capacity}\n• Hours: 09:00 AM – 06:00 PM\n• Status: Active`;
    } catch (e) {
      Object.keys(ctx).forEach((k) => delete ctx[k]);
      return `Failed to create facility: ${e.message}`;
    }
  }

  // Check inline attributes (e.g. "add facility Robotics Lab type Computer Lab capacity 40 location IT Block")
  const type = detectType(message);
  const capMatch = message.match(/(?:capacity|seats?|seats\s+for|for)\s*[:=]?\s*(\d+)/i) || message.match(/(\d+)\s*(?:capacity|seats?|people|students?)/i);
  const locMatch = message.match(/(?:location|in|at)\s*[:=]?\s*([^,;.]+)/i);
  let nameMatch = message.match(/(?:add|create|new)\s+(?:a\s+|an\s+|one\s+|the\s+)?facility\s+["']?([^,;]+?)["']?(?:,|$|\s+type|\s+capacity|\s+in|\s+with)/i);
  if (!nameMatch) {
    nameMatch = message.match(/(?:add|create|new)\s+(?:a\s+|an\s+|one\s+|the\s+)?([A-Za-z0-9 ]+?)\s+(?:with|in|at|capacity)/i);
  }
  let validName = nameMatch ? nameMatch[1].trim() : null;
  if (validName && /^(a|an|one|new|the|another|faculty|facility)$/i.test(validName)) validName = null;

  if (validName && type && capMatch) {
    const name = validName;
    const capacity = Number(capMatch[1]);
    const location = locMatch ? locMatch[1].trim() : 'Campus';
    try {
      const f = await Facility.create({
        name,
        type,
        location,
        capacity,
        description: `${type} facility located in ${location}.`,
        equipment: ['Projector', 'AC'],
        openingTime: '09:00',
        closingTime: '18:00',
        availableDays: WEEK_DAYS.slice(0, 6),
        slotDuration: 60,
        minDuration: 60,
        maxDuration: 240,
        requiresApproval: true,
        status: 'Active',
      });
      return `🎉 Facility **${f.name}** has been created!\n• Type: ${f.type} · Capacity: ${f.capacity} · Location: ${f.location}`;
    } catch (e) {
      return `Could not create facility: ${e.message}`;
    }
  }

  ctx.flow = 'admin_add';
  if (validName) {
    ctx.name = validName;
    ctx.awaiting = 'add_type';
    return `Let's add **${ctx.name}**. What type of facility is it? (${FACILITY_TYPES.join(', ')})`;
  }
  ctx.awaiting = 'add_name';
  return "Let's add a new campus facility! What is the facility's name? (e.g. \"Robotics Lab\" or \"Seminar Hall C\")";
}

/* ------------------------------------------ flow: ADMIN DELETE FACILITY */
async function adminDeleteFacilityStep(user, message) {
  if (user.role !== 'admin') return 'Managing facility statuses is restricted to administrators.';
  const isRestore = /\b(restore|activate|enable|reopen)\b/i.test(message);
  const lower = message.toLowerCase();
  const all = await Facility.find({}).select('name status').lean();
  const hit = all.sort((a, b) => b.name.length - a.name.length).find((f) => new RegExp(`\\b${escapeRegex(f.name.toLowerCase())}\\b`).test(lower));
  if (!hit) {
    return 'Which facility would you like to update? Please provide the exact name (e.g. "deactivate facility Computer Lab 3").';
  }
  const f = await Facility.findById(hit._id);
  f.status = isRestore ? 'Active' : 'Inactive';
  await f.save();
  return `Facility **${f.name}** is now **${f.status}** (${isRestore ? 'available for bookings' : 'hidden from bookings'}).`;
}

/* ------------------------------------------ flow: ADMIN MODIFY FACILITY */
async function adminModifyFacilityStep(user, message) {
  if (user.role !== 'admin') return 'Modifying facilities is restricted to administrators.';
  const lower = message.toLowerCase();
  const all = await Facility.find({}).select('name capacity location openingTime closingTime status').lean();
  const hit = all.sort((a, b) => b.name.length - a.name.length).find((f) => new RegExp(`\\b${escapeRegex(f.name.toLowerCase())}\\b`).test(lower));
  if (!hit) {
    return 'Which facility would you like to modify? Please mention the facility name (e.g. "modify facility Seminar Hall A capacity to 120").';
  }
  const f = await Facility.findById(hit._id);
  const changes = [];

  const capMatch = message.match(/(?:capacity|seats?)\s*(?:to|is|=)?\s*(\d+)/i);
  if (capMatch) {
    f.capacity = Number(capMatch[1]);
    changes.push(`capacity set to ${f.capacity}`);
  }
  const locMatch = message.match(/(?:location)\s*(?:to|is|=)?\s*([^,;]+)/i);
  if (locMatch) {
    f.location = locMatch[1].trim();
    changes.push(`location set to "${f.location}"`);
  }
  const tm = parseTimes(message);
  if (tm.startTime && tm.endTime) {
    f.openingTime = tm.startTime;
    f.closingTime = tm.endTime;
    changes.push(`hours set to ${format12(f.openingTime)} – ${format12(f.closingTime)}`);
  }

  if (!changes.length) {
    return `Found **${f.name}** (Capacity: ${f.capacity}, Location: ${f.location}, Hours: ${format12(f.openingTime)}–${format12(f.closingTime)}). What would you like to update? (e.g. "capacity to 120" or "location to Admin Block 2nd floor")`;
  }
  await f.save();
  return `✅ Updated **${f.name}**: ${changes.join(', ')}.`;
}

/* ------------------------------------------------------------------- main */
export async function runFallbackAgent({ session, user, message }) {
  const today = nowInTz().date;
  const ctx = { ...(session.bookingContext || {}) };
  const out = { reply: '', intent: session.intent || 'GENERAL_QUERY', bookingChanged: false, booking: null };
  const lower = message.toLowerCase().trim();

  const finish = (reply) => {
    out.reply = reply;
    session.bookingContext = ctx;
    session.intent = out.intent;
    return out;
  };

  if (ctx.flow && ABORT.test(message)) {
    Object.keys(ctx).forEach((k) => delete ctx[k]);
    return finish("No problem – I've cleared that request. What else can I help with?");
  }

  let intent = detectIntent(lower, user.role);
  const switchable = [
    'CANCEL_BOOKING', 'MY_BOOKINGS', 'BOOKING_STATUS', 'ADMIN_PENDING',
    'ADMIN_DECIDE', 'ADMIN_STATS', 'ADMIN_USERS', 'ADMIN_BOOKINGS_SEARCH',
    'ADMIN_FACILITY_COUNT', 'LIST_FACILITIES',
  ];
  if (ctx.flow && ctx.awaiting && !(switchable.includes(intent) && ctx.flow !== 'cancel')) intent = FLOW_INTENT[ctx.flow];
  if (!intent) intent = 'GENERAL_QUERY';
  out.intent = intent;

  if (ctx.flow && FLOW_INTENT[ctx.flow] !== intent) Object.keys(ctx).forEach((k) => delete ctx[k]);

  switch (intent) {
    case 'ADMIN_PENDING':
      return finish(await adminPendingStep(ctx, user, message, today));

    case 'ADMIN_DECIDE':
      return finish(await adminDecideStep(ctx, user, message, out));

    case 'ADMIN_STATS':
      return finish(await adminStatsStep(user));

    case 'ADMIN_USERS':
      return finish(await adminUsersStep());

    case 'ADMIN_BOOKINGS_SEARCH':
      return finish(await adminBookingsSearchStep(message, today));

    case 'ADMIN_FACILITY_COUNT':
      return finish(await adminFacilityCountStep(message));

    case 'ADMIN_ADD_FACILITY':
      return finish(await adminAddFacilityStep(ctx, user, message));

    case 'ADMIN_DELETE_FACILITY':
      return finish(await adminDeleteFacilityStep(user, message));

    case 'ADMIN_MODIFY_FACILITY':
      return finish(await adminModifyFacilityStep(user, message));

    case 'LIST_FACILITIES':
      return finish(await listFacilitiesStep(user, message));

    case 'SUGGEST_FACILITY':
      return finish(await suggestFacilityStep(ctx, message, today));

    case 'BOOK_FACILITY': {
      ctx.flow = 'book';
      if (ctx.awaiting === 'offer') {
        if (NO.test(message)) { Object.keys(ctx).forEach((k) => delete ctx[k]); return finish('No problem. Let me know if you need anything else.'); }
        ctx.awaiting = undefined;
      } else if (ctx.awaiting === 'confirm') {
        if (YES.test(message)) return finish(await doBooking(ctx, user, out));
        if (NO.test(message)) { Object.keys(ctx).forEach((k) => delete ctx[k]); return finish("Okay, I won't book it. Tell me if you'd like a different time or facility."); }
        const pick = (c) => JSON.stringify([c.date, c.startTime, c.endTime, c.participants, c.facilityType, c.facilityId, c.purpose]);
        const probe = { ...ctx, awaiting: undefined, flow: 'book' };
        await mergeEntities(probe, message, today);
        if (pick(ctx) === pick(probe)) return finish('Please reply "yes" to confirm the booking or "no" to cancel it.');
        Object.assign(ctx, probe);
        ctx.awaiting = undefined;
        return finish(await bookingStep(ctx, user));
      }
      await mergeEntities(ctx, message, today);
      return finish(await bookingStep(ctx, user));
    }
    case 'CHECK_AVAILABILITY':
    case 'SHOW_AVAILABLE_SLOTS': {
      ctx.flow = intent === 'CHECK_AVAILABILITY' ? 'check' : 'slots';
      await mergeEntities(ctx, message, today);
      return finish(await checkStep(ctx));
    }
    case 'CANCEL_BOOKING':
      return finish(await cancelStep(ctx, user, message, out));
    case 'MY_BOOKINGS': {
      const wantsAll = /\b(all|history|past)\b/.test(lower);
      const list = await svc.getUserBookings(user._id, wantsAll ? 'all' : 'upcoming');
      if (!list.length) return finish(wantsAll ? "You don't have any bookings yet." : "You don't have any upcoming bookings. Would you like to book a facility?");
      return finish(`${wantsAll ? 'Your bookings' : 'Your upcoming bookings'}:\n${list.slice(0, 10).map(describe).join('\n')}`);
    }
    case 'BOOKING_STATUS': {
      ctx.flow = 'status';
      const id = parseBookingId(message);
      if (!id) return finish(ask(ctx, 'bookingId', 'Which booking ID would you like me to check? (for example FAC1024)'));
      Object.keys(ctx).forEach((k) => delete ctx[k]);
      try {
        const b = svc.serializeBooking(await svc.getBookingForUser(id, user));
        return finish(`Booking **${b.bookingId}** (${b.facility?.name}, ${formatDateLong(b.date)}, ${formatRange(b)}) is **${b.status}**.${b.adminNote ? ` Note: ${b.adminNote}` : ''}`);
      } catch (e) {
        if (!(e instanceof BookingError)) throw e;
        return finish(`I couldn't find a booking ${id} on your account.`);
      }
    }
    case 'FACILITY_INFORMATION': {
      const nm = await matchFacilityByName(lower, user.role === 'admin');
      const type = detectType(message);
      const list = nm ? [nm] : type ? await Facility.find({ type, status: 'Active' }).limit(4) : [];
      if (!list.length) return finish('Which facility would you like to know about? For example: "Does the auditorium have a projector?"');
      const asked = ['projector', 'microphone', 'mic', 'ac', 'wifi', 'whiteboard', 'computers', 'speaker'].find((w) => new RegExp(`\\b${w}\\b`).test(lower));
      const lines = list.map((f) => {
        const has = asked ? f.equipment.some((e) => e.toLowerCase().includes(asked === 'mic' ? 'microphone' : asked)) : null;
        const head = asked ? `${has ? 'Yes' : 'No'} – ${f.name} ${has ? 'has' : 'does not list'} ${asked}. ` : '';
        return `${head}**${f.name}** – ${f.location}; capacity ${f.capacity}; open ${f.availableDays.length === 7 ? 'daily' : f.availableDays.map((d) => d.slice(0, 3)).join(', ')} ${format12(f.openingTime)}–${format12(f.closingTime)}; equipment: ${f.equipment.join(', ') || 'none listed'}.`;
      });
      return finish(lines.join('\n'));
    }
    default: {
      if (user.role === 'admin') {
        // Smart Admin fallback: check if they asked about a facility or booking
        const facHit = await matchFacilityByName(lower, true);
        if (facHit) {
          const upcoming = await Booking.find({ facilityId: facHit._id, status: { $in: ['Pending', 'Confirmed'] } }).limit(5);
          const uStr = upcoming.length
            ? `\n📅 **Upcoming Bookings:**\n${upcoming.map((b) => `• **${b.bookingId}** on ${formatDateLong(b.date)} (${format12(b.startTime)}–${format12(b.endTime)}) [${b.status}]`).join('\n')}`
            : '\n📅 No active or upcoming bookings for this facility.';
          return finish(`🏛️ **${facHit.name}** (${facHit.type})\n• Status: **${facHit.status}**\n• Location: ${facHit.location}\n• Capacity: ${facHit.capacity} people\n• Hours: ${format12(facHit.openingTime)} – ${format12(facHit.closingTime)}\n• Equipment: ${facHit.equipment.join(', ') || 'Standard'}${uStr}`);
        }

        const idHit = parseBookingId(message);
        if (idHit) {
          try {
            const b = svc.serializeBooking(await svc.getBookingForUser(idHit, user));
            return finish(`Booking **${b.bookingId}** (${b.facility?.name}, ${formatDateLong(b.date)}, ${formatRange(b)}) is **${b.status}**.\nBooked by: ${b.user?.name || 'User'} (${b.user?.email || 'N/A'})\nParticipants: ${b.participants} · Purpose: ${b.purpose}${b.adminNote ? `\nNote: ${b.adminNote}` : ''}`);
          } catch {
            return finish(`I couldn't find booking **${idHit}** in the system.`);
          }
        }

        return finish(`Hello ${user.name.split(' ')[0]}! 🛡️ I am your Campus Admin Assistant.
I can help you manage everything on campus:
• **Bookings**: "Show pending bookings", "Who booked seminar hall", "All bookings today", "Approve <ID>", "Reject <ID>"
• **Facilities**: "List all facilities", "Add a facility", "How many computer labs", "Deactivate facility Computer Lab 3", "Modify facility Seminar Hall A capacity to 120"
• **System**: "Campus stats", "Show all users"`);
      }

      const types = await Facility.distinct('type', { status: 'Active' });
      return finish(`Hi ${user.name.split(' ')[0]}! 🎓 I am your Campus Booking Assistant.
Here is what I can do:
• **Bookings**: "Book a seminar hall tomorrow 2 to 4 PM for 50 people", "Show my bookings", "Cancel booking FAC1024"
• **Recommendations**: "Suggest a facility for 60 students with projector", "Is the auditorium free at 3 PM?"
• **Explore**: "List all facilities", "Does Computer Lab 1 have AC?", "Available slots for Seminar Hall A on Friday"`);
    }
  }
}

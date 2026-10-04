/**
 * Controlled tool layer for the chatbot.
 * The AI never touches MongoDB directly: every operation goes through these functions,
 * which call the same service layer as the REST API. The user identity always comes from
 * the authenticated request (ctx.user), never from model-supplied arguments.
 */
import mongoose from 'mongoose';
import Facility, { FACILITY_TYPES, WEEK_DAYS } from '../models/Facility.js';
import Booking from '../models/Booking.js';
import User from '../models/User.js';
import * as svc from './bookingService.js';
import { BookingError } from '../utils/errors.js';
import { toMinutes, toHHmm, nowInTz, formatDateLong, formatRange } from '../utils/time.js';

export const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const briefFacility = (f) => ({
  id: String(f._id),
  name: f.name,
  type: f.type,
  location: f.location,
  capacity: f.capacity,
  description: f.description,
  equipment: f.equipment,
  openingTime: f.openingTime,
  closingTime: f.closingTime,
  availableDays: f.availableDays,
  minDurationMinutes: f.minDuration,
  maxDurationMinutes: f.maxDuration,
  requiresApproval: f.requiresApproval,
  status: f.status,
});

export const briefBooking = (b) => ({
  bookingId: b.bookingId,
  facility: b.facility?.name,
  facilityType: b.facility?.type,
  date: b.date,
  startTime: b.startTime,
  endTime: b.endTime,
  participants: b.participants,
  purpose: b.purpose,
  status: b.status,
});

export async function resolveFacility({ facilityId, name }) {
  if (facilityId && mongoose.isValidObjectId(facilityId)) return Facility.findById(facilityId);
  if (name) {
    const esc = escapeRegex(String(name).trim());
    return (await Facility.findOne({ name: new RegExp(`^${esc}$`, 'i') })) || Facility.findOne({ name: new RegExp(esc, 'i') });
  }
  return null;
}

function typeFilter(type) {
  if (!type) return null;
  const hit = FACILITY_TYPES.find((t) => t.toLowerCase() === String(type).toLowerCase());
  return hit || null;
}

const fail = (error, code = 'ERROR', extra = {}) => ({ ok: false, code, error, ...extra });

function errResult(e) {
  if (e instanceof BookingError) return fail(e.message, e.code, e.extra);
  throw e;
}

/* ------------------------------------------------------------------- tools */
export const toolImpl = {
  async searchFacilities({ type, query, minCapacity } = {}) {
    const filter = { status: 'Active' };
    const t = typeFilter(type);
    if (type && !t) return fail(`Unknown facility type. Valid types: ${FACILITY_TYPES.join(', ')}`, 'BAD_TYPE');
    if (t) filter.type = t;
    if (minCapacity) filter.capacity = { $gte: Number(minCapacity) };
    if (query) {
      const rx = new RegExp(escapeRegex(String(query)), 'i');
      filter.$or = [{ name: rx }, { location: rx }, { equipment: rx }, { description: rx }];
    }
    const list = await Facility.find(filter).sort({ type: 1, name: 1 }).limit(25);
    return { ok: true, facilities: list.map(briefFacility) };
  },

  async getFacilityDetails({ facilityId, name } = {}) {
    const f = await resolveFacility({ facilityId, name });
    if (!f) return fail('Facility not found.', 'NOT_FOUND');
    return { ok: true, facility: briefFacility(f) };
  },

  async checkAvailability({ facilityId, date, startTime, endTime, participants } = {}) {
    const f = await resolveFacility({ facilityId });
    if (!f) return fail('Facility not found.', 'NOT_FOUND');
    const r = await svc.checkRange(f, {
      date,
      startTime,
      endTime,
      participants: participants === undefined ? undefined : Number(participants),
    });
    return { ok: true, facility: f.name, ...r };
  },

  async getAvailableSlots({ facilityId, date } = {}) {
    const f = await resolveFacility({ facilityId });
    if (!f) return fail('Facility not found.', 'NOT_FOUND');
    try {
      const a = await svc.getAvailability(f, date);
      return {
        ok: true,
        facility: f.name,
        date,
        open: a.open,
        reason: a.reason,
        openingTime: a.openingTime,
        closingTime: a.closingTime,
        freeRanges: a.freeRanges,
        bookedOrUnavailableSlots: a.slots.filter((s) => !s.available).map((s) => `${s.startTime}-${s.endTime}`),
      };
    } catch (e) {
      return errResult(e);
    }
  },

  /** Find every facility of a type that can host the request (capacity + free). */
  async findAvailableFacilities({ type, date, startTime, endTime, participants } = {}) {
    const t = typeFilter(type);
    if (!t) return fail(`Unknown facility type. Valid types: ${FACILITY_TYPES.join(', ')}`, 'BAD_TYPE');
    const list = await Facility.find({ type: t, status: 'Active' }).sort({ capacity: 1 });
    if (!list.length) return { ok: true, available: [], unavailable: [], note: `No active ${t} facilities exist.` };
    const available = [];
    const unavailable = [];
    for (const f of list) {
      const r = await svc.checkRange(f, { date, startTime, endTime, participants: participants ? Number(participants) : undefined });
      if (r.available) available.push(briefFacility(f));
      else unavailable.push({ name: f.name, id: String(f._id), reason: r.reason, code: r.code, freeRanges: r.freeRanges });
    }
    return { ok: true, available, unavailable };
  },

  async createBooking(a = {}, ctx) {
    if (a.userConfirmed !== true) {
      return fail(
        'The user has not explicitly confirmed yet. Summarise facility, date, time, participants and purpose, ask "Shall I confirm?", and only call createBooking after they say yes.',
        'NOT_CONFIRMED'
      );
    }
    try {
      const b = await svc.createBooking({
        userId: ctx.user._id,
        facilityId: a.facilityId,
        date: a.date,
        startTime: a.startTime,
        endTime: a.endTime,
        purpose: a.purpose,
        participants: a.participants,
      });
      ctx.bookingChanged = true;
      ctx.booking = briefBooking(b);
      ctx.session.bookingContext = {};
      return { ok: true, booking: briefBooking(b) };
    } catch (e) {
      return errResult(e);
    }
  },

  async getMyBookings({ scope = 'upcoming' } = {}, ctx) {
    const s = ['upcoming', 'history', 'all'].includes(scope) ? scope : 'upcoming';
    const list = await svc.getUserBookings(ctx.user._id, s);
    return { ok: true, scope: s, count: list.length, bookings: list.slice(0, 20).map(briefBooking) };
  },

  async getBookingStatus({ bookingId } = {}, ctx) {
    try {
      const b = await svc.getBookingForUser(bookingId, ctx.user);
      return { ok: true, booking: briefBooking(svc.serializeBooking(b)) };
    } catch (e) {
      return errResult(e);
    }
  },

  async cancelBooking({ bookingId, userConfirmed } = {}, ctx) {
    if (userConfirmed !== true) {
      return fail('Ask the user to confirm the cancellation first (show booking ID, facility, date, time), then call again.', 'NOT_CONFIRMED');
    }
    try {
      const b = await svc.cancelBooking(bookingId, ctx.user);
      ctx.bookingChanged = true;
      return { ok: true, booking: briefBooking(b) };
    } catch (e) {
      return errResult(e);
    }
  },

  /** Stores what the chatbot has collected so far in ChatSession.bookingContext. */
  async updateBookingContext(a = {}, ctx) {
    const allowed = ['facilityType', 'facilityId', 'facilityName', 'date', 'startTime', 'endTime', 'participants', 'purpose'];
    if (a.reset) ctx.session.bookingContext = {};
    const next = { ...(ctx.session.bookingContext || {}) };
    for (const k of allowed) if (a[k] !== undefined && a[k] !== null && a[k] !== '') next[k] = a[k];
    ctx.session.bookingContext = next;
    if (a.intent) ctx.session.intent = a.intent;
    return { ok: true, bookingContext: next };
  },

  /* ------------------- Admin Tools ------------------- */
  async listPendingBookings({ date } = {}, ctx) {
    if (ctx.user.role !== 'admin') return fail('Admin access required.', 'FORBIDDEN');
    const filter = { status: 'Pending' };
    if (date) filter.date = date;
    const list = await Booking.find(filter)
      .populate('facilityId', 'name type location capacity')
      .populate('userId', 'name email department')
      .sort({ date: 1, startTime: 1 })
      .limit(50);
    return {
      ok: true,
      count: list.length,
      date: date || 'all',
      bookings: list.map((b) => ({
        bookingId: b.bookingId,
        facility: b.facilityId?.name || 'Unknown',
        facilityType: b.facilityId?.type,
        location: b.facilityId?.location,
        user: b.userId?.name || 'Unknown',
        email: b.userId?.email,
        department: b.userId?.department,
        date: b.date,
        startTime: b.startTime,
        endTime: b.endTime,
        participants: b.participants,
        purpose: b.purpose,
        createdAt: b.createdAt,
      })),
    };
  },

  async decideBookingAdmin({ bookingId, decision, adminNote } = {}, ctx) {
    if (ctx.user.role !== 'admin') return fail('Admin access required.', 'FORBIDDEN');
    const status = /reject/i.test(decision) ? 'Rejected' : 'Confirmed';
    try {
      const b = await svc.decideBooking(bookingId, status, adminNote || '');
      ctx.bookingChanged = true;
      return { ok: true, bookingId: b.bookingId, status: b.status, adminNote: b.adminNote, facility: b.facility?.name };
    } catch (e) {
      return errResult(e);
    }
  },

  async listFacilitiesAdmin({ status = 'All', type } = {}, ctx) {
    const filter = {};
    if (ctx.user.role === 'admin') {
      if (status && status !== 'All') filter.status = status;
    } else {
      filter.status = 'Active';
    }
    if (type) {
      const t = typeFilter(type);
      if (t) filter.type = t;
    }
    const list = await Facility.find(filter).sort({ status: 1, type: 1, name: 1 });
    return { ok: true, count: list.length, facilities: list.map(briefFacility) };
  },

  async addFacilityAdmin(data = {}, ctx) {
    if (ctx.user.role !== 'admin') return fail('Admin access required.', 'FORBIDDEN');
    const { name, type, location, capacity, openingTime = '09:00', closingTime = '18:00', equipment = [], availableDays = WEEK_DAYS.slice(0, 6), requiresApproval = true, description = '' } = data;
    if (!name) return fail('Facility name is required.', 'INVALID_INPUT');
    const t = typeFilter(type);
    if (!t) return fail(`Invalid type. Must be one of: ${FACILITY_TYPES.join(', ')}`, 'INVALID_INPUT');
    const cap = Number(capacity);
    if (!cap || cap <= 0) return fail('Capacity must be a positive number.', 'INVALID_INPUT');

    const existing = await Facility.findOne({ name: new RegExp(`^${escapeRegex(name)}$`, 'i') });
    if (existing) return fail(`A facility named "${name}" already exists.`, 'DUPLICATE');

    const f = await Facility.create({
      name: name.trim(),
      type: t,
      location: (location || 'Campus').trim(),
      capacity: cap,
      description: (description || `${t} facility on campus.`).trim(),
      equipment: Array.isArray(equipment) ? equipment : String(equipment).split(',').map((s) => s.trim()).filter(Boolean),
      availableDays: Array.isArray(availableDays) && availableDays.length ? availableDays : WEEK_DAYS.slice(0, 6),
      openingTime,
      closingTime,
      slotDuration: 60,
      minDuration: 60,
      maxDuration: 240,
      requiresApproval: Boolean(requiresApproval),
      status: 'Active',
    });
    return { ok: true, facility: briefFacility(f) };
  },

  async updateFacilityAdmin({ facilityId, name, updates = {} } = {}, ctx) {
    if (ctx.user.role !== 'admin') return fail('Admin access required.', 'FORBIDDEN');
    const f = await resolveFacility({ facilityId, name });
    if (!f) return fail('Facility not found.', 'NOT_FOUND');
    if (updates.capacity !== undefined) f.capacity = Number(updates.capacity);
    if (updates.location !== undefined) f.location = String(updates.location).trim();
    if (updates.description !== undefined) f.description = String(updates.description).trim();
    if (updates.openingTime !== undefined) f.openingTime = updates.openingTime;
    if (updates.closingTime !== undefined) f.closingTime = updates.closingTime;
    if (updates.status !== undefined) f.status = updates.status;
    if (updates.equipment !== undefined) {
      f.equipment = Array.isArray(updates.equipment) ? updates.equipment : String(updates.equipment).split(',').map((s) => s.trim()).filter(Boolean);
    }
    if (updates.requiresApproval !== undefined) f.requiresApproval = Boolean(updates.requiresApproval);
    await f.save();
    return { ok: true, facility: briefFacility(f) };
  },

  async deactivateFacilityAdmin({ facilityId, name, restore = false } = {}, ctx) {
    if (ctx.user.role !== 'admin') return fail('Admin access required.', 'FORBIDDEN');
    const f = await resolveFacility({ facilityId, name });
    if (!f) return fail('Facility not found.', 'NOT_FOUND');
    f.status = restore ? 'Active' : 'Inactive';
    await f.save();
    return { ok: true, facility: briefFacility(f), status: f.status };
  },

  async getAdminStats({}, ctx) {
    if (ctx.user.role !== 'admin') return fail('Admin access required.', 'FORBIDDEN');
    const [totalFacilities, activeFacilities, totalUsers, byStatus] = await Promise.all([
      Facility.countDocuments(),
      Facility.countDocuments({ status: 'Active' }),
      User.countDocuments(),
      Booking.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
    ]);
    const c = Object.fromEntries(byStatus.map((s) => [s._id, s.n]));
    const todayBookings = await Booking.countDocuments({
      date: nowInTz().date,
      status: { $in: ['Pending', 'Confirmed'] },
    });
    return {
      ok: true,
      totalFacilities,
      activeFacilities,
      totalUsers,
      totalBookings: byStatus.reduce((a, s) => a + s.n, 0),
      pendingBookings: c.Pending || 0,
      confirmedBookings: c.Confirmed || 0,
      cancelledBookings: c.Cancelled || 0,
      completedBookings: c.Completed || 0,
      rejectedBookings: c.Rejected || 0,
      todayBookings,
    };
  },

  /* ------------------- Smart Facility Suggestion Tool ------------------- */
  async suggestFacilities({ participants, equipment, type, date, startTime, endTime } = {}, ctx) {
    const pCount = participants ? Number(participants) : 1;
    const filter = { status: 'Active', capacity: { $gte: pCount } };
    const t = typeFilter(type);
    if (t) filter.type = t;
    let facilities = await Facility.find(filter).sort({ capacity: 1 });
    if (!facilities.length) {
      facilities = await Facility.find({ status: 'Active' }).sort({ capacity: -1 }).limit(5);
    }

    const eqTokens = equipment
      ? (Array.isArray(equipment) ? equipment : String(equipment).toLowerCase().split(/[, ]+/).filter(Boolean))
      : [];

    const scored = [];
    for (const f of facilities) {
      let score = 0;
      const fEq = f.equipment.map((e) => e.toLowerCase());
      for (const eq of eqTokens) {
        if (fEq.some((e) => e.includes(eq))) score += 2;
      }
      const capDiff = f.capacity - pCount;
      if (capDiff >= 0 && capDiff <= 50) score += 3;
      else if (capDiff > 50 && capDiff <= 150) score += 1;

      let available = null;
      let freeRanges = [];
      if (date && startTime && endTime) {
        const r = await svc.checkRange(f, { date, startTime, endTime, participants: pCount });
        available = r.available;
        freeRanges = r.freeRanges || [];
      } else if (date) {
        const a = await svc.getAvailability(f, date);
        freeRanges = a.freeRanges || [];
      }
      scored.push({ facility: briefFacility(f), score, available, freeRanges });
    }

    scored.sort((a, b) => b.score - a.score || a.facility.capacity - b.facility.capacity);
    return { ok: true, suggestions: scored.slice(0, 4) };
  },
};

export async function executeTool(name, input, ctx) {
  const fn = toolImpl[name];
  if (!fn) return fail(`Unknown tool: ${name}`, 'UNKNOWN_TOOL');
  try {
    return await fn(input || {}, ctx);
  } catch (e) {
    console.error(`[tool:${name}]`, e);
    return fail('Internal error while running this operation.', 'SERVER_ERROR');
  }
}

/* ------------------------------------------------- tool schemas for the LLM */
const T = FACILITY_TYPES;
const DATE = { type: 'string', description: 'Date as YYYY-MM-DD (resolve words like "tomorrow" using the calendar in the system prompt).' };
const TIME = (d) => ({ type: 'string', description: `${d} in 24-hour HH:mm, on the hour or half hour (e.g. "14:00").` });

export const TOOL_DEFS = [
  {
    name: 'searchFacilities',
    description: 'List bookable facilities, optionally filtered by type, keyword (name/location/equipment) or minimum capacity.',
    input_schema: {
      type: 'object',
      properties: { type: { type: 'string', enum: T }, query: { type: 'string' }, minCapacity: { type: 'integer' } },
    },
  },
  {
    name: 'getFacilityDetails',
    description: 'Get details (capacity, equipment, location, hours, days) for one facility by id or name.',
    input_schema: { type: 'object', properties: { facilityId: { type: 'string' }, name: { type: 'string' } } },
  },
  {
    name: 'checkAvailability',
    description: 'Check whether ONE facility is free for an exact date and time range. Returns available true/false, a reason and free ranges when busy.',
    input_schema: {
      type: 'object',
      properties: {
        facilityId: { type: 'string' },
        date: DATE,
        startTime: TIME('Start time'),
        endTime: TIME('End time'),
        participants: { type: 'integer' },
      },
      required: ['facilityId', 'date', 'startTime', 'endTime'],
    },
  },
  {
    name: 'getAvailableSlots',
    description: 'Get the free time ranges (and unavailable slots) for one facility on one date.',
    input_schema: { type: 'object', properties: { facilityId: { type: 'string' }, date: DATE }, required: ['facilityId', 'date'] },
  },
  {
    name: 'findAvailableFacilities',
    description: 'Find which facilities of a given type can host the request (free at that time and large enough). Use when the user names a type, not a specific facility.',
    input_schema: {
      type: 'object',
      properties: { type: { type: 'string', enum: T }, date: DATE, startTime: TIME('Start time'), endTime: TIME('End time'), participants: { type: 'integer' } },
      required: ['type', 'date', 'startTime', 'endTime'],
    },
  },
  {
    name: 'createBooking',
    description:
      'Create the booking. ONLY call after the user has seen a full summary and explicitly confirmed (set userConfirmed true). The result tells you whether it really succeeded; never claim success otherwise.',
    input_schema: {
      type: 'object',
      properties: {
        facilityId: { type: 'string' },
        date: DATE,
        startTime: TIME('Start time'),
        endTime: TIME('End time'),
        participants: { type: 'integer' },
        purpose: { type: 'string' },
        userConfirmed: { type: 'boolean', description: 'true only if the user explicitly confirmed this exact summary.' },
      },
      required: ['facilityId', 'date', 'startTime', 'endTime', 'participants', 'purpose', 'userConfirmed'],
    },
  },
  {
    name: 'getMyBookings',
    description: "List the signed-in user's bookings.",
    input_schema: { type: 'object', properties: { scope: { type: 'string', enum: ['upcoming', 'history', 'all'] } } },
  },
  {
    name: 'getBookingStatus',
    description: 'Look up one of the user\'s bookings by booking ID (e.g. FAC1024).',
    input_schema: { type: 'object', properties: { bookingId: { type: 'string' } }, required: ['bookingId'] },
  },
  {
    name: 'cancelBooking',
    description: 'Cancel a booking by booking ID. ONLY after the user explicitly confirmed the cancellation (userConfirmed true).',
    input_schema: {
      type: 'object',
      properties: { bookingId: { type: 'string' }, userConfirmed: { type: 'boolean' } },
      required: ['bookingId', 'userConfirmed'],
    },
  },
  {
    name: 'updateBookingContext',
    description:
      'Save details collected so far (and the detected intent) after each user message that adds information. Pass reset:true to clear when the user abandons the request.',
    input_schema: {
      type: 'object',
      properties: {
        intent: {
          type: 'string',
          enum: ['BOOK_FACILITY', 'CHECK_AVAILABILITY', 'SHOW_AVAILABLE_SLOTS', 'MY_BOOKINGS', 'BOOKING_STATUS', 'CANCEL_BOOKING', 'FACILITY_INFORMATION', 'GENERAL_QUERY', 'ADMIN_PENDING', 'ADMIN_DECIDE', 'ADMIN_STATS', 'ADMIN_ADD_FACILITY', 'ADMIN_MODIFY_FACILITY', 'ADMIN_DELETE_FACILITY', 'SUGGEST_FACILITY', 'LIST_FACILITIES'],
        },
        facilityType: { type: 'string', enum: T },
        facilityId: { type: 'string' },
        facilityName: { type: 'string' },
        date: DATE,
        startTime: TIME('Start time'),
        endTime: TIME('End time'),
        participants: { type: 'integer' },
        purpose: { type: 'string' },
        reset: { type: 'boolean' },
      },
    },
  },
  {
    name: 'listPendingBookings',
    description: 'Admin only: list pending facility booking requests that require administrator approval.',
    input_schema: { type: 'object', properties: { date: DATE } },
  },
  {
    name: 'decideBookingAdmin',
    description: 'Admin only: approve (Confirmed) or reject (Rejected) a pending booking request with an optional note.',
    input_schema: {
      type: 'object',
      properties: {
        bookingId: { type: 'string' },
        decision: { type: 'string', enum: ['Confirmed', 'Rejected'] },
        adminNote: { type: 'string' },
      },
      required: ['bookingId', 'decision'],
    },
  },
  {
    name: 'listFacilitiesAdmin',
    description: 'List facilities. Admins can see all active and inactive facilities.',
    input_schema: {
      type: 'object',
      properties: { status: { type: 'string', enum: ['All', 'Active', 'Inactive', 'Maintenance'] }, type: { type: 'string', enum: T } },
    },
  },
  {
    name: 'addFacilityAdmin',
    description: 'Admin only: add a new campus facility to the system.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        type: { type: 'string', enum: T },
        location: { type: 'string' },
        capacity: { type: 'integer' },
        openingTime: TIME('Opening time'),
        closingTime: TIME('Closing time'),
        equipment: { type: 'array', items: { type: 'string' } },
        description: { type: 'string' },
        requiresApproval: { type: 'boolean' },
      },
      required: ['name', 'type', 'capacity'],
    },
  },
  {
    name: 'updateFacilityAdmin',
    description: 'Admin only: modify or update details of an existing facility.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        facilityId: { type: 'string' },
        updates: { type: 'object' },
      },
    },
  },
  {
    name: 'deactivateFacilityAdmin',
    description: 'Admin only: deactivate (delete) or restore (activate) a facility.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        facilityId: { type: 'string' },
        restore: { type: 'boolean' },
      },
    },
  },
  {
    name: 'getAdminStats',
    description: 'Admin only: get system statistics including user count, booking counts, pending approval count, and today count.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'suggestFacilities',
    description: 'Suggest or recommend the best campus facilities for a given group size, equipment needs, or date/time.',
    input_schema: {
      type: 'object',
      properties: {
        participants: { type: 'integer' },
        equipment: { type: 'string' },
        type: { type: 'string', enum: T },
        date: DATE,
        startTime: TIME('Start time'),
        endTime: TIME('End time'),
      },
    },
  },
];

// Re-exported for the fallback agent
export { toMinutes, toHHmm };

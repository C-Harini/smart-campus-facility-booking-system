import mongoose from 'mongoose';
import Booking from '../models/Booking.js';
import Facility from '../models/Facility.js';
import Counter from '../models/Counter.js';
import { BookingError } from '../utils/errors.js';
import {
  toMinutes,
  toHHmm,
  isValidTime,
  isValidDate,
  dayName,
  nowInTz,
  format12,
} from '../utils/time.js';

export const ACTIVE_STATUSES = ['Pending', 'Confirmed'];
const BLOCK = 30; // minutes - bookings must align to 30-minute boundaries

/* ------------------------------------------------------------------ helpers */

export function slotKeysFor(facilityId, date, startTime, endTime) {
  const keys = [];
  for (let m = toMinutes(startTime); m < toMinutes(endTime); m += BLOCK) {
    keys.push(`${facilityId}|${date}|${toHHmm(m)}`);
  }
  return keys;
}

export function serializeBooking(b) {
  const o = b.toObject ? b.toObject() : { ...b };
  delete o.slotKeys;
  delete o.__v;
  const f = o.facilityId;
  const u = o.userId;
  return {
    ...o,
    facilityId: f && f._id ? f._id : f,
    facility: f && f.name ? f : undefined,
    userId: u && u._id ? u._id : u,
    user: u && u.name ? u : undefined,
  };
}

const populate = (q) => q.populate('facilityId', 'name type location').populate('userId', 'name email department');

async function nextBookingId() {
  const c = await Counter.findOneAndUpdate({ _id: 'booking' }, { $inc: { seq: 1 } }, { upsert: true, new: true });
  return `FAC${1023 + c.seq}`; // first booking is FAC1024
}

/** Mark confirmed bookings whose end time has passed as Completed. */
export async function refreshCompleted() {
  const { date, time } = nowInTz();
  await Booking.updateMany(
    { status: 'Confirmed', $or: [{ date: { $lt: date } }, { date, endTime: { $lte: time } }] },
    { $set: { status: 'Completed' } }
  );
}

/* --------------------------------------------------------------- validation */

/** Returns null when the request obeys the facility rules, otherwise {code, reason}. */
export function ruleViolation(facility, { date, startTime, endTime, participants }) {
  if (!facility) return { code: 'NOT_FOUND', reason: 'Facility not found.' };
  if (facility.status !== 'Active') {
    return {
      code: 'INACTIVE',
      reason: `${facility.name} is currently ${facility.status.toLowerCase()} and cannot be booked.`,
    };
  }
  if (!isValidDate(date)) return { code: 'INVALID_DATE', reason: 'Please provide a valid date (YYYY-MM-DD).' };
  if (!isValidTime(startTime) || !isValidTime(endTime)) {
    return { code: 'INVALID_TIME', reason: 'Times must be in 24-hour HH:mm format.' };
  }
  const s = toMinutes(startTime);
  const e = toMinutes(endTime);
  if (e <= s) return { code: 'INVALID_TIME', reason: 'The end time must be after the start time.' };
  if (s % BLOCK || e % BLOCK) {
    return { code: 'INVALID_TIME', reason: 'Bookings must start and end on the hour or half hour.' };
  }
  const now = nowInTz();
  if (date < now.date || (date === now.date && startTime <= now.time)) {
    return { code: 'PAST', reason: 'That date/time is in the past.' };
  }
  if (!facility.availableDays.includes(dayName(date))) {
    return {
      code: 'CLOSED_DAY',
      reason: `${facility.name} is not available on ${dayName(date)}s. It is open ${facility.availableDays.join(', ')}.`,
    };
  }
  if (s < toMinutes(facility.openingTime) || e > toMinutes(facility.closingTime)) {
    return {
      code: 'OUTSIDE_HOURS',
      reason: `${facility.name} operates from ${format12(facility.openingTime)} to ${format12(facility.closingTime)}.`,
    };
  }
  const dur = e - s;
  if (dur < facility.minDuration || dur > facility.maxDuration) {
    return {
      code: 'DURATION',
      reason: `Bookings for ${facility.name} must be between ${facility.minDuration} and ${facility.maxDuration} minutes.`,
    };
  }
  if (participants !== undefined) {
    if (!Number.isInteger(participants) || participants < 1) {
      return { code: 'INVALID_PARTICIPANTS', reason: 'Number of participants must be a positive whole number.' };
    }
    if (participants > facility.capacity) {
      return {
        code: 'CAPACITY',
        reason: `${facility.name} can hold at most ${facility.capacity} people (requested ${participants}).`,
      };
    }
  }
  return null;
}

/* ------------------------------------------------------------- availability */

export async function findConflicts(facilityId, date, startTime, endTime) {
  return Booking.find({
    facilityId,
    date,
    status: 'Confirmed',
    startTime: { $lt: endTime },
    endTime: { $gt: startTime },
  });
}

/** Slot-by-slot availability for one facility on one date. */
export async function getAvailability(facility, date) {
  const base = {
    facilityId: String(facility._id),
    facilityName: facility.name,
    date,
    openingTime: facility.openingTime,
    closingTime: facility.closingTime,
    slots: [],
    freeRanges: [],
  };
  if (!isValidDate(date)) throw new BookingError('Please provide a valid date (YYYY-MM-DD).', 400, 'INVALID_DATE');
  if (facility.status !== 'Active') {
    return { ...base, open: false, reason: `${facility.name} is currently ${facility.status.toLowerCase()}.` };
  }
  if (!facility.availableDays.includes(dayName(date))) {
    return {
      ...base,
      open: false,
      reason: `${facility.name} is closed on ${dayName(date)}s (open ${facility.availableDays.join(', ')}).`,
    };
  }
  const booked = await Booking.find({ facilityId: facility._id, date, status: 'Confirmed' }).lean();
  const now = nowInTz();
  const step = facility.slotDuration;
  const close = toMinutes(facility.closingTime);
  const slots = [];
  for (let m = toMinutes(facility.openingTime); m + step <= close; m += step) {
    const startTime = toHHmm(m);
    const endTime = toHHmm(m + step);
    const isPast = date < now.date || (date === now.date && startTime <= now.time);
    const isBooked = booked.some((b) => b.startTime < endTime && b.endTime > startTime);
    slots.push({
      startTime,
      endTime,
      available: !isPast && !isBooked,
      reason: isBooked ? 'booked' : isPast ? 'past' : undefined,
    });
  }
  const freeRanges = [];
  for (const s of slots) {
    if (!s.available) continue;
    const last = freeRanges[freeRanges.length - 1];
    if (last && last.endTime === s.startTime) last.endTime = s.endTime;
    else freeRanges.push({ startTime: s.startTime, endTime: s.endTime });
  }
  const usable = freeRanges.filter((r) => toMinutes(r.endTime) - toMinutes(r.startTime) >= facility.minDuration);
  return { ...base, open: true, slots, freeRanges: usable };
}

/** Non-throwing availability check for an arbitrary time range. */
export async function checkRange(facility, req) {
  const v = ruleViolation(facility, req);
  if (v) return { available: false, ...v, freeRanges: [] };
  const conflicts = await findConflicts(facility._id, req.date, req.startTime, req.endTime);
  if (conflicts.length) {
    const av = await getAvailability(facility, req.date);
    return {
      available: false,
      code: 'CONFLICT',
      reason: `${facility.name} is already booked during part of ${format12(req.startTime)} – ${format12(req.endTime)}.`,
      freeRanges: av.freeRanges,
    };
  }
  return { available: true, freeRanges: [] };
}

/* ----------------------------------------------------------------- bookings */

export async function createBooking({ userId, facilityId, date, startTime, endTime, purpose, participants }) {
  if (!mongoose.isValidObjectId(facilityId)) throw new BookingError('Invalid facility.', 400, 'NOT_FOUND');
  const facility = await Facility.findById(facilityId);
  const pCount = Number(participants);
  const cleanPurpose = String(purpose || '').trim();
  if (!cleanPurpose) throw new BookingError('Please provide the purpose of the booking.', 400, 'INVALID_PURPOSE');
  if (cleanPurpose.length > 200) throw new BookingError('Purpose is too long (max 200 characters).', 400, 'INVALID_PURPOSE');

  const v = ruleViolation(facility, { date, startTime, endTime, participants: pCount });
  if (v) throw new BookingError(v.reason, v.code === 'NOT_FOUND' ? 404 : 400, v.code);

  const conflictError = async () => {
    const av = await getAvailability(facility, date);
    return new BookingError('That time slot is already booked.', 409, 'CONFLICT', { freeRanges: av.freeRanges });
  };

  // FINAL availability check, immediately before insert against Confirmed bookings.
  if ((await findConflicts(facility._id, date, startTime, endTime)).length) throw await conflictError();

  const userPending = mongoose.isValidObjectId(userId)
    ? await Booking.findOne({
        userId,
        facilityId: facility._id,
        date,
        startTime,
        endTime,
        status: 'Pending',
      })
    : null;
  if (userPending) {
    throw new BookingError(`You already have a pending booking request (${userPending.bookingId}) for this slot. Please wait for admin approval.`, 400, 'DUPLICATE_REQUEST');
  }

  const bookingId = await nextBookingId();
  try {
    const booking = await Booking.create({
      bookingId,
      userId,
      facilityId: facility._id,
      date,
      startTime,
      endTime,
      purpose: cleanPurpose,
      participants: pCount,
      status: 'Pending',
      slotKeys: undefined, // Only Confirmed bookings lock slotKeys
    });
    return serializeBooking(await populate(Booking.findById(booking._id)));
  } catch (err) {
    // Unique index on slotKeys: another request grabbed an overlapping slot between check and insert.
    if (err?.code === 11000) throw await conflictError();
    throw err;
  }
}

export async function findBookingByRef(ref) {
  const r = String(ref || '').trim();
  let q = null;
  if (/^FAC\d+$/i.test(r)) q = Booking.findOne({ bookingId: r.toUpperCase() });
  else if (mongoose.isValidObjectId(r)) q = Booking.findById(r);
  if (!q) return null;
  return populate(q);
}

function assertCanAccess(booking, user) {
  const ownerId = String(booking.userId?._id || booking.userId);
  if (user.role !== 'admin' && ownerId !== String(user._id)) {
    throw new BookingError('Booking not found.', 404, 'NOT_FOUND'); // do not leak existence
  }
}

export async function getBookingForUser(ref, user) {
  const b = await findBookingByRef(ref);
  if (!b) throw new BookingError('Booking not found.', 404, 'NOT_FOUND');
  assertCanAccess(b, user);
  return b;
}

export async function cancelBooking(ref, user) {
  const b = await getBookingForUser(ref, user);
  if (!ACTIVE_STATUSES.includes(b.status)) {
    throw new BookingError(`A ${b.status.toLowerCase()} booking cannot be cancelled.`, 400, 'INVALID_STATE');
  }
  b.status = 'Cancelled';
  b.slotKeys = undefined; // releases the slot (field is $unset)
  await b.save();
  return serializeBooking(b);
}

export async function decideBooking(ref, status, adminNote = '') {
  if (!['Confirmed', 'Rejected', 'Cancelled'].includes(status)) {
    throw new BookingError('Status must be Confirmed, Rejected or Cancelled.', 400, 'INVALID_STATE');
  }
  const b = await findBookingByRef(ref);
  if (!b) throw new BookingError('Booking not found.', 404, 'NOT_FOUND');
  const allowed = {
    Confirmed: ['Pending'],
    Rejected: ['Pending'],
    Cancelled: ACTIVE_STATUSES,
  };
  if (!allowed[status].includes(b.status)) {
    throw new BookingError(`Cannot change a ${b.status.toLowerCase()} booking to ${status.toLowerCase()}.`, 400, 'INVALID_STATE');
  }
  const facilityId = b.facilityId?._id || b.facilityId;

  if (status === 'Confirmed') {
    const conflicts = await findConflicts(facilityId, b.date, b.startTime, b.endTime);
    if (conflicts.length) {
      throw new BookingError('Cannot approve: this time slot is already confirmed for another booking.', 409, 'CONFLICT');
    }
    b.status = 'Confirmed';
    b.slotKeys = slotKeysFor(facilityId, b.date, b.startTime, b.endTime);
    if (adminNote) b.adminNote = String(adminNote).slice(0, 300);
    await b.save();

    // Automatically reject competing Pending requests for the overlapping time slot
    await Booking.updateMany(
      {
        _id: { $ne: b._id },
        facilityId,
        date: b.date,
        status: 'Pending',
        startTime: { $lt: b.endTime },
        endTime: { $gt: b.startTime },
      },
      {
        $set: {
          status: 'Rejected',
          adminNote: `Another booking (${b.bookingId}) was approved for this time slot.`,
        },
        $unset: { slotKeys: 1 },
      }
    );
  } else {
    b.status = status;
    if (adminNote) b.adminNote = String(adminNote).slice(0, 300);
    b.slotKeys = undefined;
    await b.save();
  }

  return serializeBooking(b);
}

const upcomingClause = () => {
  const { date, time } = nowInTz();
  return { $or: [{ date: { $gt: date } }, { date, endTime: { $gt: time } }] };
};

export async function getUserBookings(userId, scope = 'all') {
  await refreshCompleted();
  let filter = { userId };
  if (scope === 'upcoming') filter = { ...filter, status: { $in: ACTIVE_STATUSES }, ...upcomingClause() };
  else if (scope === 'history') {
    filter = {
      ...filter,
      $or: [{ status: { $in: ['Completed', 'Cancelled', 'Rejected'] } }, { date: { $lt: nowInTz().date } }],
    };
  }
  const sort = scope === 'upcoming' ? { date: 1, startTime: 1 } : { date: -1, startTime: -1 };
  const list = await populate(Booking.find(filter).sort(sort).limit(200));
  return list.map(serializeBooking);
}

export async function listAllBookings({ status, facilityId, date, userId } = {}) {
  await refreshCompleted();
  const filter = {};
  if (status && status !== 'All') filter.status = status;
  if (facilityId && mongoose.isValidObjectId(facilityId)) filter.facilityId = facilityId;
  if (userId && mongoose.isValidObjectId(userId)) filter.userId = userId;
  if (date && isValidDate(date)) filter.date = date;
  const list = await populate(Booking.find(filter).sort({ date: -1, startTime: -1 }).limit(500));
  return list.map(serializeBooking);
}

// Logic tests that do not need MongoDB: Booking/Facility queries are stubbed.
import test from 'node:test';
import assert from 'node:assert/strict';
import Booking from '../src/models/Booking.js';
import Facility from '../src/models/Facility.js';
import { ruleViolation, getAvailability, checkRange, slotKeysFor } from '../src/services/bookingService.js';
import { guardReply } from '../src/services/llmAgent.js';
import { dayName } from '../src/utils/time.js';

const hall = new Facility({
  name: 'Seminar Hall A', type: 'Seminar Hall', location: 'Main Block', capacity: 100,
  availableDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  openingTime: '09:00', closingTime: '17:00', slotDuration: 60, minDuration: 60, maxDuration: 240,
});
const MONDAY = '2030-01-07';
const SUNDAY = '2030-01-06';

function stubBookings(list) {
  Booking.find = (q) => {
    const filtered = list.filter((b) => (!q.status || (q.status.$in ? q.status.$in.includes(b.status) : b.status === q.status)));
    const rows = filtered.filter((b) => b.startTime < (q.startTime?.$lt ?? '99') && b.endTime > (q.endTime?.$gt ?? '00'));
    const p = Promise.resolve(q.startTime ? rows : filtered);
    p.lean = async () => filtered;
    return p;
  };
}

test('calendar sanity', () => assert.equal(dayName(MONDAY), 'Monday'));

test('rules: valid, closed day, hours, duration, capacity', () => {
  const ok = { date: MONDAY, startTime: '14:00', endTime: '16:00', participants: 40 };
  assert.equal(ruleViolation(hall, ok), null);
  assert.equal(ruleViolation(hall, { ...ok, date: SUNDAY }).code, 'CLOSED_DAY');
  assert.equal(ruleViolation(hall, { ...ok, startTime: '08:00' }).code, 'OUTSIDE_HOURS');
  assert.equal(ruleViolation(hall, { ...ok, endTime: '18:00' }).code, 'OUTSIDE_HOURS');
  assert.equal(ruleViolation(hall, { ...ok, startTime: '09:00', endTime: '15:00' }).code, 'DURATION');
  assert.equal(ruleViolation(hall, { ...ok, participants: 101 }).code, 'CAPACITY');
  assert.equal(ruleViolation(hall, { ...ok, endTime: '14:00' }).code, 'INVALID_TIME');
  assert.equal(ruleViolation(hall, { ...ok, startTime: '14:15' }).code, 'INVALID_TIME');
  assert.equal(ruleViolation(hall, { ...ok, date: '2020-01-06' }).code, 'PAST');
  hall.status = 'Maintenance';
  assert.equal(ruleViolation(hall, ok).code, 'INACTIVE');
  hall.status = 'Active';
});

test('availability: booked 14-16 leaves 9-14 and 16-17 (spec scenario)', async () => {
  stubBookings([{ startTime: '14:00', endTime: '16:00', status: 'Confirmed' }]);
  const a = await getAvailability(hall, MONDAY);
  assert.equal(a.slots.length, 8);
  assert.deepEqual(a.freeRanges, [{ startTime: '09:00', endTime: '14:00' }, { startTime: '16:00', endTime: '17:00' }]);
  assert.equal(a.slots.find((s) => s.startTime === '14:00').available, false);

  const r = await checkRange(hall, { date: MONDAY, startTime: '14:00', endTime: '16:00', participants: 40 });
  assert.equal(r.available, false);
  assert.equal(r.code, 'CONFLICT');
  assert.equal(r.freeRanges.length, 2);

  // back-to-back is NOT a conflict
  const adj = await checkRange(hall, { date: MONDAY, startTime: '16:00', endTime: '17:00', participants: 10 });
  assert.equal(adj.available, true);
  // partial overlap IS a conflict
  const part = await checkRange(hall, { date: MONDAY, startTime: '15:00', endTime: '17:00', participants: 10 });
  assert.equal(part.code, 'CONFLICT');
});

test('closed day returns open:false', async () => {
  stubBookings([]);
  const a = await getAvailability(hall, SUNDAY);
  assert.equal(a.open, false);
});

test('slot keys cover every 30-minute block', () => {
  const k = slotKeysFor('F1', MONDAY, '14:00', '16:00');
  assert.deepEqual(k, ['F1|2030-01-07|14:00', 'F1|2030-01-07|14:30', 'F1|2030-01-07|15:00', 'F1|2030-01-07|15:30']);
});

test('guard: never claim a booking the backend did not create', () => {
  const session = { messages: [{ role: 'user', content: 'yes confirm' }] };
  const fake = guardReply('Booking confirmed! Your booking ID is FAC1024.', [], session);
  assert.match(fake, /couldn't verify|haven't completed/);
  const real = guardReply('Booking confirmed! Your booking ID is FAC1024.', [{ name: 'createBooking', output: { ok: true, booking: { bookingId: 'FAC1024' } } }], session);
  assert.match(real, /FAC1024/);
  const claim = guardReply('Your booking has been confirmed.', [], session);
  assert.match(claim, /haven't completed/);
  const failed = guardReply('Your booking has been confirmed.', [{ name: 'createBooking', output: { ok: false } }], session);
  assert.match(failed, /haven't completed/);
});

test('multiple students can submit pending requests for the same slot until admin approves', async () => {
  // When only pending bookings exist, slot remains available for others to book
  stubBookings([{ startTime: '10:00', endTime: '12:00', status: 'Pending' }]);
  const checkPending = await checkRange(hall, { date: MONDAY, startTime: '10:00', endTime: '12:00', participants: 30 });
  assert.equal(checkPending.available, true, 'Pending booking does not block other students from requesting the slot');

  // Once admin approves, status becomes Confirmed and blocks the slot
  stubBookings([{ startTime: '10:00', endTime: '12:00', status: 'Confirmed' }]);
  const checkConfirmed = await checkRange(hall, { date: MONDAY, startTime: '10:00', endTime: '12:00', participants: 30 });
  assert.equal(checkConfirmed.available, false, 'Confirmed booking blocks any re-booking');
  assert.equal(checkConfirmed.code, 'CONFLICT');
});

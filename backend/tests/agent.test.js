// Drives the rule-based agent through the conversations from the spec, with the DB layer stubbed in memory.
import test from 'node:test';
import assert from 'node:assert/strict';
import Booking from '../src/models/Booking.js';
import Facility from '../src/models/Facility.js';
import Counter from '../src/models/Counter.js';
import { runFallbackAgent } from '../src/services/fallbackAgent.js';

const ALL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const mk = (name, type, capacity, extra = {}) =>
  new Facility({ name, type, location: 'Block', capacity, availableDays: ALL, openingTime: '08:00', closingTime: '18:00', equipment: ['Projector'], ...extra });
const facilities = [mk('Seminar Hall A', 'Seminar Hall', 100), mk('Computer Lab 1', 'Computer Lab', 30), mk('Computer Lab 2', 'Computer Lab', 50)];
const bookings = [];
let created = 0;

const chain = (v) => {
  const p = Promise.resolve(v);
  for (const m of ['sort', 'select', 'limit', 'lean', 'populate']) p[m] = () => chain(v);
  return p;
};
import User from '../src/models/User.js';
Facility.find = (q = {}) => chain(facilities.filter((f) => (!q.type || f.type === q.type) && (!q.status || f.status === q.status)));
Facility.findById = (id) => chain(facilities.find((f) => String(f._id) === String(id)) || null);
Facility.distinct = async () => ['Computer Lab', 'Seminar Hall'];
Facility.countDocuments = async () => facilities.length;
User.countDocuments = async () => 2;
Counter.findOneAndUpdate = async () => ({ seq: ++created });
Booking.updateMany = async () => ({ modifiedCount: 0 });
Booking.countDocuments = async () => bookings.length;
Booking.aggregate = async () => [{ _id: 'Confirmed', n: bookings.length }];
Booking.find = (q) => {
  const rows = bookings.filter((b) => (!q.status || (q.status.$in ? q.status.$in.includes(b.status) : b.status === q.status)) && b.status !== 'Cancelled' && (!q.startTime || (b.date === q.date && b.startTime < q.startTime.$lt && b.endTime > q.endTime.$gt)) && (!q.facilityId || String(b.facilityId) === String(q.facilityId)));
  const p = chain(rows);
  p.lean = async () => bookings.filter((b) => (!q.status || (q.status.$in ? q.status.$in.includes(b.status) : b.status === q.status)) && b.status !== 'Cancelled' && String(b.facilityId) === String(q.facilityId) && b.date === q.date);
  return p;
};
Booking.create = async (d) => { const doc = { ...d, status: d.status, toObject() { return { ...this }; } }; bookings.push(doc); return doc; };
Booking.findById = () => {
  const b = bookings[bookings.length - 1];
  const f = facilities.find((x) => String(x._id) === String(b.facilityId));
  const res = { ...b, toObject: () => ({ ...b, facilityId: { _id: f._id, name: f.name, type: f.type, location: f.location } }) };
  const p = Promise.resolve(res);
  p.populate = () => p;
  return p;
};

const user = { _id: 'u1', name: 'Harini Student', role: 'student' };
const session = { messages: [], bookingContext: {}, intent: 'GENERAL_QUERY' };
const say = async (message) => (await runFallbackAgent({ session, user, message })).reply;

test('full guided conversation (spec section 19) creates a real booking', async () => {
  let r = await say('I need a place for a department meeting tomorrow.');
  assert.match(r, /type of facility/i);
  r = await say('A seminar hall.');
  assert.match(r, /what time/i);
  r = await say('10 AM to 1 PM.');
  assert.match(r, /how many participants/i);
  r = await say('Around 60.');
  assert.match(r, /Seminar Hall A is available/);
  assert.match(r, /100 people/);
  assert.equal(bookings.length, 0, 'nothing booked before confirmation');
  // purpose was already given in the first message, so we should be at the confirm step
  assert.match(r, /Shall I confirm/);
  r = await say('Confirm.');
  assert.match(r, /FAC1024/);
  assert.equal(bookings.length, 1);
  assert.equal(bookings[0].startTime, '10:00');
  assert.equal(bookings[0].endTime, '13:00');
  assert.equal(bookings[0].participants, 60);
  assert.equal(bookings[0].purpose, 'Department meeting');
  assert.equal(bookings[0].status, 'Pending');
  // Admin approves the booking, locking the slot as Confirmed
  bookings[0].status = 'Confirmed';
});

test('one-shot request extracts everything', async () => {
  const s2 = { messages: [], bookingContext: {}, intent: 'GENERAL_QUERY' };
  const go = async (m) => (await runFallbackAgent({ session: s2, user, message: m })).reply;
  const r = await go('I need a computer lab tomorrow from 2 to 4 PM for a workshop with 35 students');
  assert.match(r, /Computer Lab 2 is available/); // 35 > Lab 1 capacity 30
  assert.match(r, /Shall I confirm/);
  assert.equal(s2.bookingContext.participants, 35);
  assert.equal(s2.intent, 'BOOK_FACILITY');
});

test('conflict offers alternatives and then books the chosen one', async () => {
  const s3 = { messages: [], bookingContext: {}, intent: 'GENERAL_QUERY' };
  const go = async (m) => (await runFallbackAgent({ session: s3, user, message: m })).reply;
  // Seminar Hall A tomorrow 10-13 is taken by the first test
  let r = await go('Book Seminar Hall A tomorrow from 11 to 12 for a quiz with 20 people');
  assert.match(r, /already booked/);
  assert.match(r, /8:00 AM – 10:00 AM/);
  assert.match(r, /1:00 PM – 6:00 PM/);
  r = await go('the first one'); // picks 08:00-10:00
  assert.match(r, /Shall I confirm/);
  r = await go('yes');
  assert.match(r, /FAC1025/);
});

test('availability check, info, and no false success', async () => {
  const s4 = { messages: [], bookingContext: {}, intent: 'GENERAL_QUERY' };
  const go = async (m) => (await runFallbackAgent({ session: s4, user, message: m })).reply;
  let r = await go('Is the seminar hall free tomorrow at 11 AM?');
  assert.match(r, /already booked|❌/);
  r = await go('Does Seminar Hall A have a projector?');
  assert.match(r, /^Yes/);
  const before = bookings.length;
  r = await go('Book a computer lab');
  r = await go('cancel');
  assert.match(r, /cleared/);
  assert.equal(bookings.length, before);
});

test('student facility suggestion intent recommends facilities', async () => {
  const s = { messages: [], bookingContext: {}, intent: 'GENERAL_QUERY' };
  const res = await runFallbackAgent({ session: s, user, message: 'Suggest a facility for 40 people with projector' });
  assert.equal(res.intent, 'SUGGEST_FACILITY');
  assert.match(res.reply, /Recommendations/i);
});

test('admin chatbot capabilities: stats, list facilities, and pending bookings', async () => {
  const adminUser = { _id: 'admin1', name: 'Campus Admin', role: 'admin' };
  const sAdmin = { messages: [], bookingContext: {}, intent: 'GENERAL_QUERY' };

  // Admin stats
  const rStats = await runFallbackAgent({ session: sAdmin, user: adminUser, message: 'Campus stats' });
  assert.equal(rStats.intent, 'ADMIN_STATS');
  assert.match(rStats.reply, /Campus Booking System Stats/i);

  // List facilities as admin
  const rList = await runFallbackAgent({ session: sAdmin, user: adminUser, message: 'List all facilities' });
  assert.equal(rList.intent, 'LIST_FACILITIES');
  assert.match(rList.reply, /Campus Facilities/i);

  // Pending bookings
  const rPending = await runFallbackAgent({ session: sAdmin, user: adminUser, message: 'Show pending bookings' });
  assert.equal(rPending.intent, 'ADMIN_PENDING');
});


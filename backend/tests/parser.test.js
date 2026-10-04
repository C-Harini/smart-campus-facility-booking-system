import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDate, parseTimes, parseParticipants, detectType, parsePurposeInline, parseBookingId } from '../src/nlp/parser.js';
import { isValidDate, format12, addDays } from '../src/utils/time.js';

const TODAY = '2026-10-03'; // Saturday

test('dates', () => {
  assert.equal(parseDate('tomorrow', TODAY), '2026-10-04');
  assert.equal(parseDate('day after tomorrow', TODAY), '2026-10-05');
  assert.equal(parseDate('next Monday afternoon', TODAY), '2026-10-05');
  assert.equal(parseDate('on friday', TODAY), '2026-10-09');
  assert.equal(parseDate('10 October 2026', TODAY), '2026-10-10');
  assert.equal(parseDate('oct 10', TODAY), '2026-10-10');
  assert.equal(parseDate('2nd of January', TODAY), '2027-01-02');
  assert.equal(parseDate('15/10/2026', TODAY), '2026-10-15');
  assert.equal(parseDate('2026-11-01', TODAY), '2026-11-01');
  assert.equal(parseDate('no date here', TODAY), null);
});

test('time ranges', () => {
  assert.deepEqual(parseTimes('From 2 to 4 PM'), { startTime: '14:00', endTime: '16:00' });
  assert.deepEqual(parseTimes('10 AM to 1 PM'), { startTime: '10:00', endTime: '13:00' });
  assert.deepEqual(parseTimes('tomorrow from 10 to 1 for a department event'), { startTime: '10:00', endTime: '13:00' });
  assert.deepEqual(parseTimes('9:30am - 11am'), { startTime: '09:30', endTime: '11:00' });
  assert.deepEqual(parseTimes('2 to 4', { awaitingTime: true }), { startTime: '14:00', endTime: '16:00' });
  assert.deepEqual(parseTimes('10 to 12 pm'), { startTime: '10:00', endTime: '12:00' });
});

test('single times and durations', () => {
  assert.equal(parseTimes('is it free at 3 PM?').startTime, '15:00');
  assert.equal(parseTimes('at 15:30').startTime, '15:30');
  const t = parseTimes('at 2 pm for 2 hours');
  assert.equal(t.startTime, '14:00');
  assert.equal(t.endTime, '16:00');
  assert.equal(parseTimes('next monday afternoon').timeOfDay, 'afternoon');
});

test('numbers are not mistaken for times', () => {
  assert.deepEqual(parseTimes('we are 60 to 70 people'), {});
  assert.deepEqual(parseTimes('on 2026-10-10 with 35 students'), {});
  assert.equal(parseParticipants('35 students'), 35);
  assert.equal(parseParticipants('around 60', true), 60);
  assert.equal(parseParticipants('around 60', false), null);
});

test('types, purpose and ids', () => {
  assert.equal(detectType('Need a computer lab'), 'Computer Lab');
  assert.equal(detectType('book the seminar hall'), 'Seminar Hall');
  assert.equal(detectType('a department meeting'), null);
  assert.equal(parsePurposeInline('I need a place for a department meeting tomorrow'), 'Department meeting');
  assert.equal(parsePurposeInline('auditorium tomorrow for a department event with 150 students'), 'Department event');
  assert.equal(parsePurposeInline('book it for tomorrow'), null);
  assert.equal(parseBookingId('Cancel my booking fac1024 please'), 'FAC1024');
});

test('time utils', () => {
  assert.equal(format12('14:00'), '2:00 PM');
  assert.equal(format12('00:30'), '12:30 AM');
  assert.ok(isValidDate('2026-02-28'));
  assert.ok(!isValidDate('2026-02-30'));
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});

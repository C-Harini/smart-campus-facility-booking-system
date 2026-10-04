import 'dotenv/config';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { connectDB } from './config/db.js';
import User from './models/User.js';
import Facility, { WEEK_DAYS } from './models/Facility.js';
import Booking from './models/Booking.js';
import Counter from './models/Counter.js';
import ChatSession from './models/ChatSession.js';

const MON_SAT = WEEK_DAYS.slice(0, 6);
const MON_FRI = WEEK_DAYS.slice(0, 5);

const facilities = [
  { name: 'Seminar Hall A', type: 'Seminar Hall', location: 'Main Block - 2nd Floor', capacity: 100, description: 'Spacious hall for talks and department meetings.', equipment: ['Projector', 'AC', 'Microphone'], availableDays: MON_SAT, openingTime: '09:00', closingTime: '17:00', maxDuration: 240, requiresApproval: true },
  { name: 'Seminar Hall B', type: 'Seminar Hall', location: 'Main Block - 3rd Floor', capacity: 60, description: 'Mid-sized seminar hall.', equipment: ['Projector', 'AC'], availableDays: MON_SAT, openingTime: '09:00', closingTime: '17:00', maxDuration: 240, requiresApproval: true },
  { name: 'Main Auditorium', type: 'Auditorium', location: 'Admin Block - Ground Floor', capacity: 500, description: 'Large auditorium for events and convocations.', equipment: ['Projector', 'AC', 'Microphone', 'Sound System', 'Stage Lighting'], availableDays: MON_SAT, openingTime: '09:00', closingTime: '18:00', maxDuration: 480, requiresApproval: true },
  { name: 'Computer Lab 1', type: 'Computer Lab', location: 'IT Block - 1st Floor', capacity: 40, description: '40 workstations with dual-boot OS.', equipment: ['40 Computers', 'Projector', 'AC', 'Wi-Fi'], availableDays: MON_FRI, openingTime: '09:00', closingTime: '17:00', maxDuration: 240, requiresApproval: true },
  { name: 'Computer Lab 2', type: 'Computer Lab', location: 'IT Block - 2nd Floor', capacity: 50, description: '50 workstations, programming and AI labs.', equipment: ['50 Computers', 'Projector', 'AC', 'Wi-Fi'], availableDays: MON_FRI, openingTime: '09:00', closingTime: '17:00', maxDuration: 240, requiresApproval: true },
  { name: 'Computer Lab 3', type: 'Computer Lab', location: 'IT Block - 3rd Floor', capacity: 30, description: 'Small lab for workshops.', equipment: ['30 Computers', 'Whiteboard', 'AC'], availableDays: MON_FRI, openingTime: '09:00', closingTime: '17:00', maxDuration: 240, requiresApproval: true },
  { name: 'Classroom 101', type: 'Classroom', location: 'Main Block - 1st Floor', capacity: 60, description: 'Standard lecture classroom.', equipment: ['Projector', 'Whiteboard'], availableDays: MON_SAT, openingTime: '08:00', closingTime: '17:00', maxDuration: 240, requiresApproval: true },
  { name: 'Classroom 102', type: 'Classroom', location: 'Main Block - 1st Floor', capacity: 60, description: 'Standard lecture classroom.', equipment: ['Projector', 'Whiteboard'], availableDays: MON_SAT, openingTime: '08:00', closingTime: '17:00', maxDuration: 240, requiresApproval: true },
  { name: 'Conference Room 1', type: 'Conference Room', location: 'Admin Block - 2nd Floor', capacity: 25, description: 'Boardroom-style conference room with video conferencing.', equipment: ['Display Screen', 'Video Conferencing', 'AC'], availableDays: MON_FRI, openingTime: '09:00', closingTime: '18:00', maxDuration: 240, requiresApproval: true },
  { name: 'Meeting Room 1', type: 'Meeting Room', location: 'Library - 1st Floor', capacity: 10, description: 'Small room for group discussions.', equipment: ['Whiteboard', 'TV Screen'], availableDays: MON_SAT, openingTime: '09:00', closingTime: '18:00', maxDuration: 180, requiresApproval: true },
  { name: 'Sports Ground', type: 'Sports Ground', location: 'Campus East', capacity: 300, description: 'Full-size ground for football and cricket.', equipment: ['Floodlights', 'Goal Posts'], availableDays: WEEK_DAYS, openingTime: '06:00', closingTime: '18:00', maxDuration: 180, requiresApproval: true },
  { name: 'Basketball Court', type: 'Basketball Court', location: 'Sports Complex', capacity: 30, description: 'Outdoor court with floodlights.', equipment: ['Hoops', 'Floodlights'], availableDays: WEEK_DAYS, openingTime: '06:00', closingTime: '20:00', maxDuration: 120, requiresApproval: true },
  { name: 'Volleyball Court', type: 'Volleyball Court', location: 'Sports Complex', capacity: 24, description: 'Sand volleyball court.', equipment: ['Net', 'Floodlights'], availableDays: WEEK_DAYS, openingTime: '06:00', closingTime: '20:00', maxDuration: 120, requiresApproval: true },
  { name: 'Indoor Hall', type: 'Indoor Hall', location: 'Sports Complex', capacity: 80, description: 'Indoor hall for badminton, table tennis and events.', equipment: ['Badminton Courts', 'Table Tennis', 'Fans'], availableDays: MON_SAT, openingTime: '07:00', closingTime: '19:00', maxDuration: 180, requiresApproval: true },
];

async function upsertUser({ name, email, password, role, department }) {
  const existing = await User.findOne({ email });
  if (existing) return existing;
  return User.create({ name, email, role, department, password: await bcrypt.hash(password, 10) });
}

await connectDB();

if (process.argv.includes('--fresh')) {
  await Promise.all([User.deleteMany({}), Facility.deleteMany({}), Booking.deleteMany({}), Counter.deleteMany({}), ChatSession.deleteMany({})]);
  console.log('Existing data removed (--fresh).');
}
await Booking.init();

await upsertUser({ name: 'Campus Admin', email: 'admin@campus.edu', password: 'Admin@123', role: 'admin', department: 'Administration' });
await upsertUser({ name: 'Harini Student', email: 'student@campus.edu', password: 'Student@123', role: 'student', department: 'CSE' });

for (const f of facilities) {
  await Facility.updateOne({ name: f.name }, { $setOnInsert: { slotDuration: 60, minDuration: 60, status: 'Active', ...f } }, { upsert: true });
}

console.log(`Seeded ${facilities.length} facilities.`);
console.log('Admin   : admin@campus.edu   / Admin@123');
console.log('Student : student@campus.edu / Student@123');
await mongoose.disconnect();

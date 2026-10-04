import mongoose from 'mongoose';

export const FACILITY_TYPES = [
  'Classroom',
  'Computer Lab',
  'Seminar Hall',
  'Auditorium',
  'Conference Room',
  'Sports Ground',
  'Basketball Court',
  'Volleyball Court',
  'Indoor Hall',
  'Meeting Room',
];
export const WEEK_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const FACILITY_STATUSES = ['Active', 'Inactive', 'Maintenance'];

const facilitySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    type: { type: String, enum: FACILITY_TYPES, required: true },
    location: { type: String, required: true, trim: true },
    capacity: { type: Number, required: true, min: 1 },
    description: { type: String, default: '' },
    equipment: { type: [String], default: [] },
    availableDays: { type: [String], enum: WEEK_DAYS, default: WEEK_DAYS.slice(0, 5) },
    openingTime: { type: String, required: true, default: '09:00' }, // HH:mm
    closingTime: { type: String, required: true, default: '17:00' }, // HH:mm
    // Booking duration rules (minutes)
    slotDuration: { type: Number, default: 60, min: 30 },
    minDuration: { type: Number, default: 60, min: 30 },
    maxDuration: { type: Number, default: 240, min: 30 },
    requiresApproval: { type: Boolean, default: true },
    status: { type: String, enum: FACILITY_STATUSES, default: 'Active' },
    image: { type: String, default: '' },
  },
  { timestamps: true }
);

export default mongoose.model('Facility', facilitySchema);

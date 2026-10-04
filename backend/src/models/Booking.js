import mongoose from 'mongoose';

export const BOOKING_STATUSES = ['Pending', 'Confirmed', 'Rejected', 'Cancelled', 'Completed'];

const bookingSchema = new mongoose.Schema({
  bookingId: { type: String, required: true, unique: true }, // e.g. FAC1024
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  facilityId: { type: mongoose.Schema.Types.ObjectId, ref: 'Facility', required: true },
  date: { type: String, required: true }, // YYYY-MM-DD
  startTime: { type: String, required: true }, // HH:mm
  endTime: { type: String, required: true }, // HH:mm
  purpose: { type: String, required: true, trim: true, maxlength: 200 },
  participants: { type: Number, required: true, min: 1 },
  status: { type: String, enum: BOOKING_STATUSES, default: 'Confirmed' },
  adminNote: { type: String, default: '' },
  /**
   * One key per 30-minute block, e.g. "<facilityId>|2026-10-10|14:00".
   * A UNIQUE index on this field makes the database itself reject overlapping
   * active bookings, even if two requests pass the application-level check at the
   * same instant. The field is $unset when a booking is cancelled/rejected, and the
   * index is sparse, so released bookings no longer occupy the slot.
   */
  slotKeys: { type: [String], default: undefined },
  createdAt: { type: Date, default: Date.now },
});

bookingSchema.index({ facilityId: 1, date: 1, status: 1 });
bookingSchema.index({ slotKeys: 1 }, { unique: true, sparse: true });

export default mongoose.model('Booking', bookingSchema);

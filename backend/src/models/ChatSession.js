import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, required: true },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const chatSessionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    messages: { type: [messageSchema], default: [] },
    intent: { type: String, default: 'GENERAL_QUERY' },
    // facilityType, facilityId, facilityName, date, startTime, endTime, participants, purpose (+ agent flow state)
    bookingContext: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true, minimize: false } // createdAt / updatedAt
);

export default mongoose.model('ChatSession', chatSessionSchema);

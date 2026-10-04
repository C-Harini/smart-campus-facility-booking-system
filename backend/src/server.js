import 'dotenv/config';
import app from './app.js';
import { connectDB } from './config/db.js';
import Booking from './models/Booking.js';
import { llmEnabled } from './services/llmAgent.js';

if (!process.env.JWT_SECRET) {
  console.error('JWT_SECRET is not set. Copy .env.example to .env and set it.');
  process.exit(1);
}

const port = process.env.PORT || 5000;

await connectDB();
await Booking.init(); // make sure the unique slot index exists before accepting bookings
app.listen(port, () => {
  const mode = process.env.GEMINI_API_KEY
    ? `LLM (Google Gemini - ${process.env.GEMINI_MODEL || 'gemini-2.5-flash'})`
    : process.env.ANTHROPIC_API_KEY
    ? `LLM (Anthropic - ${process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5'})`
    : 'built-in offline NLP (set GEMINI_API_KEY or ANTHROPIC_API_KEY to enable LLM)';
  console.log(`API running on http://localhost:${port}`);
  console.log(`Chat agent mode: ${mode}`);
});

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import ChatSession from '../models/ChatSession.js';
import { protect } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../utils/errors.js';
import { llmEnabled, runLlmAgent } from '../services/llmAgent.js';
import { runFallbackAgent } from '../services/fallbackAgent.js';

const router = Router();
router.use(protect);

const limiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false, message: { message: 'Too many messages, please slow down.' } });

async function getSession(userId) {
  return (
    (await ChatSession.findOne({ userId }).sort({ updatedAt: -1 })) ||
    (await ChatSession.create({ userId, messages: [], bookingContext: {} }))
  );
}

const publicContext = (c = {}) => {
  const { facilityType, facilityName, date, startTime, endTime, participants, purpose } = c;
  return { facilityType, facilityName, date, startTime, endTime, participants, purpose };
};

router.get(
  '/history',
  asyncHandler(async (req, res) => {
    const s = await getSession(req.user._id);
    res.json({ messages: s.messages.slice(-50).map((m) => ({ role: m.role, content: m.content })), mode: llmEnabled() ? 'llm' : 'rules' });
  })
);

router.post(
  '/reset',
  asyncHandler(async (req, res) => {
    const s = await getSession(req.user._id);
    s.messages = [];
    s.bookingContext = {};
    s.intent = 'GENERAL_QUERY';
    s.markModified('bookingContext');
    await s.save();
    res.json({ ok: true });
  })
);

/**
 * Receive message -> identify intent -> extract entities -> check context -> call backend tools -> reply.
 */
router.post(
  '/',
  limiter,
  asyncHandler(async (req, res) => {
    const message = String(req.body.message || '').trim();
    if (!message) throw new HttpError(400, 'Message is required.');
    if (message.length > 1000) throw new HttpError(400, 'Message is too long (max 1000 characters).');

    const session = await getSession(req.user._id);
    session.messages.push({ role: 'user', content: message });

    const args = { session, user: req.user, message };
    let result;
    let mode = 'rules';
    try {
      if (llmEnabled()) {
        mode = 'llm';
        result = await runLlmAgent(args);
      } else {
        result = await runFallbackAgent(args);
      }
    } catch (err) {
      console.error(`[chat:${mode}]`, err?.message || err);
      try {
        mode = 'rules';
        result = await runFallbackAgent(args);
      } catch (err2) {
        console.error('[chat:fallback]', err2);
        result = { reply: 'Sorry, I ran into a problem and could not complete that. Please try again or use the booking form.', bookingChanged: false, booking: null };
      }
    }

    session.messages.push({ role: 'assistant', content: result.reply });
    if (session.messages.length > 100) session.messages = session.messages.slice(-100);
    session.markModified('bookingContext');
    await session.save();

    res.json({
      reply: result.reply,
      intent: session.intent,
      bookingContext: publicContext(session.bookingContext),
      bookingChanged: Boolean(result.bookingChanged),
      booking: result.booking || null,
      mode,
    });
  })
);

export default router;

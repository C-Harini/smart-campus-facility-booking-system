import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import authRoutes from './routes/auth.js';
import facilityRoutes from './routes/facilities.js';
import bookingRoutes from './routes/bookings.js';
import userRoutes from './routes/users.js';
import adminRoutes from './routes/admin.js';
import chatRoutes from './routes/chat.js';
import { notFound, errorHandler } from './middleware/error.js';

const app = express();

app.use(helmet());
const allowedOrigins = (process.env.CLIENT_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((s) => s.trim());

app.use(
  cors({
    origin: allowedOrigins.includes('*') ? true : allowedOrigins,
    credentials: true,
  })
);
app.use(express.json({ limit: '100kb' }));
if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'));

app.get('/api/health', (req, res) => res.json({ ok: true }));

const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 50, standardHeaders: true, legacyHeaders: false, message: { message: 'Too many attempts, try again later.' } });
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/facilities', facilityRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/users', userRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/chat', chatRoutes);

app.use(notFound);
app.use(errorHandler);

export default app;

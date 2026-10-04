import { HttpError } from '../utils/errors.js';

export function notFound(req, res) {
  res.status(404).json({ message: `Route not found: ${req.method} ${req.originalUrl}` });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ message: err.message, code: err.code, ...err.extra });
  }
  if (err.name === 'ValidationError') {
    const first = Object.values(err.errors || {})[0];
    return res.status(400).json({ message: first?.message || 'Validation failed.', code: 'VALIDATION' });
  }
  if (err.name === 'CastError') return res.status(400).json({ message: 'Invalid id or value.', code: 'CAST' });
  if (err.code === 11000) return res.status(409).json({ message: 'A record with that value already exists.', code: 'DUPLICATE' });
  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    return res.status(401).json({ message: 'Invalid or expired token.', code: 'AUTH' });
  }
  if (err.status && err.status < 500) return res.status(err.status).json({ message: err.message });
  console.error(err);
  res.status(500).json({ message: 'Internal server error.' });
}

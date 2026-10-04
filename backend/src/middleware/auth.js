import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { HttpError } from '../utils/errors.js';

export async function protect(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new HttpError(401, 'Authentication required.');
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);
    if (!user) throw new HttpError(401, 'User no longer exists.');
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

export function adminOnly(req, res, next) {
  if (req.user?.role !== 'admin') return next(new HttpError(403, 'Admin access required.'));
  next();
}

import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { protect } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../utils/errors.js';

const router = Router();

const sign = (user) =>
  jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });

const publicUser = (u) => ({
  _id: u._id,
  name: u.name,
  email: u.email,
  role: u.role,
  department: u.department,
  createdAt: u.createdAt,
});

router.post(
  '/register',
  asyncHandler(async (req, res) => {
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const department = String(req.body.department || '').trim();
    if (!name) throw new HttpError(400, 'Name is required.');
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new HttpError(400, 'A valid email is required.');
    if (password.length < 6) throw new HttpError(400, 'Password must be at least 6 characters.');
    if (await User.findOne({ email })) throw new HttpError(409, 'An account with this email already exists.');

    // Public registration can only create students. Admins are created via seed or by another admin.
    const user = await User.create({ name, email, department, role: 'student', password: await bcrypt.hash(password, 10) });
    res.status(201).json({ token: sign(user), user: publicUser(user) });
  })
);

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const user = await User.findOne({ email }).select('+password');
    if (!user || !(await bcrypt.compare(password, user.password))) {
      throw new HttpError(401, 'Invalid email or password.');
    }
    res.json({ token: sign(user), user: publicUser(user) });
  })
);

router.get('/me', protect, (req, res) => res.json({ user: publicUser(req.user) }));

export default router;

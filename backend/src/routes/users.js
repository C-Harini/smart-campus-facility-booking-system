import { Router } from 'express';
import mongoose from 'mongoose';
import User from '../models/User.js';
import Booking from '../models/Booking.js';
import { protect, adminOnly } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../utils/errors.js';

const router = Router();
router.use(protect, adminOnly);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(await User.find().sort({ createdAt: -1 }));
  })
);

router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const u = mongoose.isValidObjectId(req.params.id) ? await User.findById(req.params.id) : null;
    if (!u) throw new HttpError(404, 'User not found.');
    if (req.body.name !== undefined) u.name = String(req.body.name).trim();
    if (req.body.department !== undefined) u.department = String(req.body.department).trim();
    if (req.body.role !== undefined) {
      if (!['student', 'admin'].includes(req.body.role)) throw new HttpError(400, 'Invalid role.');
      if (String(u._id) === String(req.user._id) && req.body.role !== 'admin') {
        throw new HttpError(400, 'You cannot remove your own admin role.');
      }
      u.role = req.body.role;
    }
    await u.save();
    res.json(u);
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    if (String(req.params.id) === String(req.user._id)) throw new HttpError(400, 'You cannot delete your own account.');
    const u = mongoose.isValidObjectId(req.params.id) ? await User.findById(req.params.id) : null;
    if (!u) throw new HttpError(404, 'User not found.');
    const active = await Booking.countDocuments({ userId: u._id, status: { $in: ['Pending', 'Confirmed'] } });
    if (active) throw new HttpError(400, `User has ${active} active booking(s). Cancel them first.`);
    await u.deleteOne();
    res.json({ message: 'User deleted.' });
  })
);

export default router;

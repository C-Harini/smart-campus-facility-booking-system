import { Router } from 'express';
import Facility from '../models/Facility.js';
import Booking from '../models/Booking.js';
import User from '../models/User.js';
import { protect, adminOnly } from '../middleware/auth.js';
import { asyncHandler } from '../utils/errors.js';
import { refreshCompleted } from '../services/bookingService.js';
import { nowInTz, addDays, toMinutes } from '../utils/time.js';

const router = Router();
router.use(protect, adminOnly);

router.get(
  '/stats',
  asyncHandler(async (req, res) => {
    await refreshCompleted();
    const [totalFacilities, activeFacilities, totalUsers, byStatus] = await Promise.all([
      Facility.countDocuments(),
      Facility.countDocuments({ status: 'Active' }),
      User.countDocuments(),
      Booking.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
    ]);
    const c = Object.fromEntries(byStatus.map((s) => [s._id, s.n]));
    const totalBookings = byStatus.reduce((a, s) => a + s.n, 0);
    const todayBookings = await Booking.countDocuments({
      date: nowInTz().date,
      status: { $in: ['Pending', 'Confirmed'] },
    });
    res.json({
      totalFacilities,
      activeFacilities,
      totalUsers,
      totalBookings,
      pendingBookings: c.Pending || 0,
      confirmedBookings: c.Confirmed || 0,
      cancelledBookings: c.Cancelled || 0,
      completedBookings: c.Completed || 0,
      rejectedBookings: c.Rejected || 0,
      todayBookings,
    });
  })
);

router.get(
  '/reports',
  asyncHandler(async (req, res) => {
    await refreshCompleted();
    const today = nowInTz().date;
    const since = addDays(today, -13);
    const all = await Booking.find().populate('facilityId', 'name type').lean();

    const perFacility = new Map();
    const perDay = new Map();
    for (let i = 0; i < 14; i++) perDay.set(addDays(since, i), 0);
    const byStatus = {};
    for (const b of all) {
      byStatus[b.status] = (byStatus[b.status] || 0) + 1;
      const name = b.facilityId?.name || 'Deleted facility';
      const row = perFacility.get(name) || { facility: name, type: b.facilityId?.type || '-', total: 0, active: 0, cancelled: 0, hoursBooked: 0 };
      row.total += 1;
      if (['Confirmed', 'Completed', 'Pending'].includes(b.status)) {
        row.active += 1;
        row.hoursBooked += (toMinutes(b.endTime) - toMinutes(b.startTime)) / 60;
      }
      if (b.status === 'Cancelled') row.cancelled += 1;
      perFacility.set(name, row);
      if (perDay.has(b.date) && ['Pending', 'Confirmed', 'Completed'].includes(b.status)) {
        perDay.set(b.date, perDay.get(b.date) + 1);
      }
    }
    res.json({
      byStatus,
      perFacility: [...perFacility.values()].sort((a, b) => b.total - a.total),
      perDay: [...perDay.entries()].map(([date, count]) => ({ date, count })),
    });
  })
);

export default router;

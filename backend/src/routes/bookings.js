import { Router } from 'express';
import { protect, adminOnly } from '../middleware/auth.js';
import { asyncHandler } from '../utils/errors.js';
import * as svc from '../services/bookingService.js';

const router = Router();
router.use(protect);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { facilityId, date, startTime, endTime, purpose, participants } = req.body;
    // userId always comes from the verified JWT, never from the request body.
    const booking = await svc.createBooking({
      userId: req.user._id,
      facilityId,
      date,
      startTime,
      endTime,
      purpose,
      participants,
    });
    res.status(201).json(booking);
  })
);

router.get(
  '/my',
  asyncHandler(async (req, res) => {
    const scope = ['upcoming', 'history', 'all'].includes(req.query.scope) ? req.query.scope : 'all';
    res.json(await svc.getUserBookings(req.user._id, scope));
  })
);

// Admin: all bookings (filters: status, facilityId, date, userId)
router.get(
  '/',
  adminOnly,
  asyncHandler(async (req, res) => {
    res.json(await svc.listAllBookings(req.query));
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json(svc.serializeBooking(await svc.getBookingForUser(req.params.id, req.user)));
  })
);

router.put(
  '/:id/cancel',
  asyncHandler(async (req, res) => {
    res.json(await svc.cancelBooking(req.params.id, req.user));
  })
);

// Admin: approve / reject (Pending -> Confirmed | Rejected)
router.put(
  '/:id/status',
  adminOnly,
  asyncHandler(async (req, res) => {
    res.json(await svc.decideBooking(req.params.id, req.body.status, req.body.adminNote));
  })
);

export default router;

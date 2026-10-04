import { Router } from 'express';
import mongoose from 'mongoose';
import Facility, { WEEK_DAYS } from '../models/Facility.js';
import { protect, adminOnly } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../utils/errors.js';
import { getAvailability } from '../services/bookingService.js';
import { isValidTime, isValidDate, toMinutes, nowInTz } from '../utils/time.js';

const router = Router();
router.use(protect);

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function cleanPayload(b) {
  const out = {};
  for (const k of ['name', 'type', 'location', 'description', 'image', 'status', 'openingTime', 'closingTime']) {
    if (b[k] !== undefined) out[k] = String(b[k]).trim();
  }
  for (const k of ['capacity', 'slotDuration', 'minDuration', 'maxDuration']) {
    if (b[k] !== undefined) out[k] = Number(b[k]);
  }
  if (b.equipment !== undefined) {
    const arr = Array.isArray(b.equipment) ? b.equipment : String(b.equipment).split(',');
    out.equipment = arr.map((s) => String(s).trim()).filter(Boolean);
  }
  if (b.availableDays !== undefined) {
    out.availableDays = [].concat(b.availableDays).filter((d) => WEEK_DAYS.includes(d));
  }
  if (b.requiresApproval !== undefined) out.requiresApproval = Boolean(b.requiresApproval);
  return out;
}

function assertRules(f) {
  if (!isValidTime(f.openingTime) || !isValidTime(f.closingTime) || toMinutes(f.openingTime) >= toMinutes(f.closingTime)) {
    throw new HttpError(400, 'Opening/closing times must be HH:mm and closing must be after opening.');
  }
  const m30 = (n) => Number.isInteger(n) && n >= 30 && n % 30 === 0;
  if (![f.openingTime, f.closingTime].every((t) => toMinutes(t) % 30 === 0)) {
    throw new HttpError(400, 'Opening and closing times must be on the hour or half hour.');
  }
  if (!m30(f.slotDuration) || !m30(f.minDuration) || !m30(f.maxDuration)) {
    throw new HttpError(400, 'Slot, minimum and maximum durations must be multiples of 30 minutes.');
  }
  if (f.minDuration > f.maxDuration) throw new HttpError(400, 'Minimum duration cannot exceed maximum duration.');
  if (!f.availableDays?.length) throw new HttpError(400, 'Select at least one available day.');
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const filter = {};
    const { q, type, minCapacity, status } = req.query;
    if (req.user.role === 'admin') {
      if (status && status !== 'All') filter.status = String(status);
    } else {
      filter.status = 'Active';
    }
    if (type && type !== 'All') filter.type = String(type);
    if (minCapacity && Number(minCapacity) > 0) filter.capacity = { $gte: Number(minCapacity) };
    if (q) {
      const rx = new RegExp(escapeRegex(String(q).slice(0, 60)), 'i');
      filter.$or = [{ name: rx }, { location: rx }, { description: rx }, { equipment: rx }, { type: rx }];
    }
    res.json(await Facility.find(filter).sort({ type: 1, name: 1 }));
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const f = mongoose.isValidObjectId(req.params.id) ? await Facility.findById(req.params.id) : null;
    if (!f || (f.status !== 'Active' && req.user.role !== 'admin')) throw new HttpError(404, 'Facility not found.');
    res.json(f);
  })
);

router.get(
  '/:id/availability',
  asyncHandler(async (req, res) => {
    const f = mongoose.isValidObjectId(req.params.id) ? await Facility.findById(req.params.id) : null;
    if (!f) throw new HttpError(404, 'Facility not found.');
    const date = String(req.query.date || nowInTz().date);
    if (!isValidDate(date)) throw new HttpError(400, 'date must be YYYY-MM-DD.');
    res.json(await getAvailability(f, date));
  })
);

router.post(
  '/',
  adminOnly,
  asyncHandler(async (req, res) => {
    const data = cleanPayload(req.body);
    const draft = new Facility(data);
    assertRules(draft);
    await draft.validate();
    res.status(201).json(await draft.save());
  })
);

router.put(
  '/:id',
  adminOnly,
  asyncHandler(async (req, res) => {
    const f = mongoose.isValidObjectId(req.params.id) ? await Facility.findById(req.params.id) : null;
    if (!f) throw new HttpError(404, 'Facility not found.');
    f.set(cleanPayload(req.body));
    assertRules(f);
    res.json(await f.save());
  })
);

// "Remove" = deactivate, so historical bookings keep a valid reference.
router.delete(
  '/:id',
  adminOnly,
  asyncHandler(async (req, res) => {
    const f = mongoose.isValidObjectId(req.params.id) ? await Facility.findById(req.params.id) : null;
    if (!f) throw new HttpError(404, 'Facility not found.');
    f.status = 'Inactive';
    res.json(await f.save());
  })
);

export default router;

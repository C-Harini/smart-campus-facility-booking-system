import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import api, { errMsg } from '../api';
import type { Availability, Booking, Facility } from '../types';
import { fmtDateLong, fmtRange, fmtTime, notifyBookingsChanged, todayStr } from '../utils';
import SlotGrid from '../components/SlotGrid';
import StatusBadge from '../components/StatusBadge';

const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

export default function BookFacility() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const [facility, setFacility] = useState<Facility | null>(null);
  const [date, setDate] = useState(params.get('date') || todayStr());
  const [avail, setAvail] = useState<Availability | null>(null);
  const [sel, setSel] = useState<[number, number] | null>(null);
  const [purpose, setPurpose] = useState('');
  const [participants, setParticipants] = useState('');
  const [step, setStep] = useState<'select' | 'review' | 'done'>('select');
  const [booking, setBooking] = useState<Booking | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<Facility>(`/facilities/${id}`).then((r) => setFacility(r.data)).catch((e) => setError(errMsg(e)));
  }, [id]);

  const loadAvail = () =>
    api
      .get<Availability>(`/facilities/${id}/availability`, { params: { date } })
      .then((r) => setAvail(r.data))
      .catch((e) => setError(errMsg(e)));

  useEffect(() => {
    setSel(null);
    setAvail(null);
    loadAvail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, date]);

  const range = useMemo(() => {
    if (!sel || !avail) return null;
    return { startTime: avail.slots[sel[0]].startTime, endTime: avail.slots[sel[1]].endTime };
  }, [sel, avail]);

  const pick = (i: number) => {
    if (!avail) return;
    if (!sel || sel[0] !== sel[1]) return setSel([i, i]);
    const [a] = sel;
    if (i < a) return setSel([i, i]);
    const between = avail.slots.slice(a, i + 1);
    setSel(between.every((s) => s.available) ? [a, i] : [i, i]);
  };

  const duration = range ? minutes(range.endTime) - minutes(range.startTime) : 0;

  const review = () => {
    setError('');
    const n = Number(participants);
    if (!range) return setError('Select a time slot first.');
    if (!purpose.trim()) return setError('Please enter the purpose.');
    if (!Number.isInteger(n) || n < 1) return setError('Enter a valid number of participants.');
    if (facility && n > facility.capacity) return setError(`Capacity of ${facility.name} is ${facility.capacity}.`);
    if (facility && (duration < facility.minDuration || duration > facility.maxDuration)) {
      return setError(`Booking length must be between ${facility.minDuration} and ${facility.maxDuration} minutes.`);
    }
    setStep('review');
  };

  const confirm = async () => {
    if (!range) return;
    setBusy(true);
    setError('');
    try {
      const r = await api.post<Booking>('/bookings', {
        facilityId: id, date, ...range, purpose: purpose.trim(), participants: Number(participants),
      });
      setBooking(r.data);
      setStep('done');
      notifyBookingsChanged();
    } catch (e) {
      setError(errMsg(e));
      setStep('select');
      setSel(null);
      loadAvail(); // slot may have been taken meanwhile
    } finally {
      setBusy(false);
    }
  };

  if (!facility) return error ? <div className="alert error">{error}</div> : <p className="muted">Loading…</p>;

  if (step === 'done' && booking) {
    return (
      <div className="card center-card">
        <h1>{booking.status === 'Pending' ? '⏳ Request submitted' : '✅ Booking confirmed'}</h1>
        <p className="mono big">Booking ID: {booking.bookingId}</p>
        <p>Status: <StatusBadge status={booking.status} /></p>
        <p><strong>{facility.name}</strong><br />{fmtDateLong(booking.date)}<br />{fmtRange(booking.startTime, booking.endTime)}<br />{booking.participants} participants · {booking.purpose}</p>
        {booking.status === 'Pending' && <p className="muted small">An admin must approve this facility before it is confirmed.</p>}
        <div className="row gap"><Link className="btn btn-primary" to="/my-bookings">My Bookings</Link><Link className="btn" to="/facilities">Book another</Link></div>
      </div>
    );
  }

  return (
    <div>
      <Link to="/facilities" className="small">← All facilities</Link>
      <h1>{facility.name}</h1>
      <p className="muted">{facility.type} · {facility.location} · Capacity {facility.capacity} · {fmtRange(facility.openingTime, facility.closingTime)} · {facility.availableDays.length === 7 ? 'Every day' : facility.availableDays.map((d) => d.slice(0, 3)).join(', ')}</p>
      {facility.equipment.length > 0 && <p className="small">🔧 {facility.equipment.join(', ')}</p>}
      {facility.description && <p>{facility.description}</p>}
      {error && <div className="alert error">{error}</div>}

      {step === 'select' && (
        <>
          <div className="card">
            <label>Date<input type="date" min={todayStr()} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} /></label>
            <h3>Available Slots</h3>
            {!avail ? <p className="muted">Loading…</p> : !avail.open ? <div className="alert">{avail.reason}</div> : (
              <>
                <p className="muted small">Click a start slot, then click an end slot to book several hours in a row. Booked slots are disabled.</p>
                <SlotGrid slots={avail.slots} selection={sel} onPick={pick} />
              </>
            )}
          </div>

          {range && (
            <div className="card">
              <h3>Booking details</h3>
              <p>Selected: <strong>{fmtRange(range.startTime, range.endTime)}</strong> ({duration / 60} h)</p>
              <div className="row gap wrap">
                <label className="grow">Purpose<input value={purpose} maxLength={200} onChange={(e) => setPurpose(e.target.value)} placeholder="Department meeting" /></label>
                <label>Participants<input type="number" min={1} max={facility.capacity} value={participants} onChange={(e) => setParticipants(e.target.value)} /></label>
              </div>
              <button className="btn btn-primary" onClick={review}>Review booking</button>
            </div>
          )}
        </>
      )}

      {step === 'review' && range && (
        <div className="card">
          <h3>Confirm your booking</h3>
          <p><strong>{facility.name}</strong><br />{fmtDateLong(date)}<br />{fmtTime(range.startTime)} – {fmtTime(range.endTime)}<br />{participants} participants<br />Purpose: {purpose}</p>
          <div className="alert">Note: Every booking requires administrator approval; your request will be submitted as Pending.</div>
          <div className="row gap">
            <button className="btn btn-primary" onClick={confirm} disabled={busy}>{busy ? 'Booking…' : 'Confirm Booking'}</button>
            <button className="btn" onClick={() => setStep('select')} disabled={busy}>Back</button>
          </div>
        </div>
      )}
    </div>
  );
}

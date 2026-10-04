import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errMsg } from '../api';
import { useAuth } from '../auth';
import type { Booking } from '../types';
import { fmtDate, fmtRange } from '../utils';
import StatusBadge from '../components/StatusBadge';

export default function Dashboard() {
  const { user } = useAuth();
  const [upcoming, setUpcoming] = useState<Booking[] | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api
      .get<Booking[]>('/bookings/my', { params: { scope: 'upcoming' } })
      .then((r) => setUpcoming(r.data))
      .catch((e) => setError(errMsg(e)));
  }, []);

  useEffect(() => {
    load();
    window.addEventListener('bookings:changed', load);
    return () => window.removeEventListener('bookings:changed', load);
  }, [load]);

  return (
    <div>
      <h1>Welcome, {user?.name}</h1>
      {error && <div className="alert error">{error}</div>}

      <h2>Upcoming Bookings</h2>
      {upcoming === null ? (
        <p className="muted">Loading…</p>
      ) : upcoming.length === 0 ? (
        <div className="card muted">No upcoming bookings. Use the quick actions below or ask the 💬 assistant.</div>
      ) : (
        <div className="grid">
          {upcoming.slice(0, 3).map((b) => (
            <div className="card" key={b._id}>
              <div className="row between">
                <strong>{b.facility?.name}</strong>
                <StatusBadge status={b.status} />
              </div>
              <p>{fmtDate(b.date)}</p>
              <p>{fmtRange(b.startTime, b.endTime)}</p>
              <p className="muted small">{b.purpose} · {b.participants} participants</p>
              <p className="mono">{b.bookingId}</p>
            </div>
          ))}
        </div>
      )}

      <h2>Quick Actions</h2>
      <div className="row gap">
        <Link className="btn btn-primary" to="/facilities">Book Facility</Link>
        <Link className="btn" to="/my-bookings">My Bookings</Link>
        <Link className="btn" to="/availability">Check Availability</Link>
      </div>
    </div>
  );
}

import { useCallback, useEffect, useState } from 'react';
import api, { errMsg } from '../api';
import type { Booking } from '../types';
import { fmtDate, fmtRange, notifyBookingsChanged } from '../utils';
import StatusBadge from '../components/StatusBadge';

type Scope = 'upcoming' | 'history' | 'all';

export default function MyBookings() {
  const [scope, setScope] = useState<Scope>('upcoming');
  const [list, setList] = useState<Booking[] | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api
      .get<Booking[]>('/bookings/my', { params: { scope } })
      .then((r) => setList(r.data))
      .catch((e) => setError(errMsg(e)));
  }, [scope]);

  useEffect(() => {
    setList(null);
    load();
    window.addEventListener('bookings:changed', load);
    return () => window.removeEventListener('bookings:changed', load);
  }, [load]);

  const cancel = async (b: Booking) => {
    if (!window.confirm(`Cancel booking ${b.bookingId} (${b.facility?.name}, ${fmtDate(b.date)})?`)) return;
    try {
      await api.put(`/bookings/${b._id}/cancel`);
      notifyBookingsChanged();
    } catch (e) {
      setError(errMsg(e));
    }
  };

  const canCancel = (b: Booking) => ['Pending', 'Confirmed'].includes(b.status);

  return (
    <div>
      <h1>My Bookings</h1>
      <div className="tabs">
        {(['upcoming', 'history', 'all'] as Scope[]).map((s) => (
          <button key={s} className={scope === s ? 'tab active' : 'tab'} onClick={() => setScope(s)}>
            {s === 'history' ? 'Booking history' : s[0].toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>
      {error && <div className="alert error">{error}</div>}
      {list === null ? <p className="muted">Loading…</p> : list.length === 0 ? <div className="card muted">Nothing here yet.</div> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>ID</th><th>Facility</th><th>Date</th><th>Time</th><th>Participants</th><th>Purpose</th><th>Status</th><th /></tr></thead>
            <tbody>
              {list.map((b) => (
                <tr key={b._id}>
                  <td className="mono">{b.bookingId}</td>
                  <td>{b.facility?.name}</td>
                  <td>{fmtDate(b.date)}</td>
                  <td>{fmtRange(b.startTime, b.endTime)}</td>
                  <td>{b.participants}</td>
                  <td>{b.purpose}</td>
                  <td><StatusBadge status={b.status} /></td>
                  <td>{canCancel(b) && scope !== 'history' && <button className="btn btn-danger" onClick={() => cancel(b)}>Cancel</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

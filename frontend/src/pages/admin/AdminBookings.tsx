import { useCallback, useEffect, useState } from 'react';
import api, { errMsg } from '../../api';
import type { Booking } from '../../types';
import { fmtDate, fmtRange } from '../../utils';
import StatusBadge from '../../components/StatusBadge';

const STATUSES = ['All', 'Pending', 'Confirmed', 'Rejected', 'Cancelled', 'Completed'];

export default function AdminBookings() {
  const [status, setStatus] = useState('All');
  const [date, setDate] = useState('');
  const [list, setList] = useState<Booking[] | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api.get<Booking[]>('/bookings', { params: { status, date: date || undefined } }).then((r) => setList(r.data)).catch((e) => setError(errMsg(e)));
  }, [status, date]);
  useEffect(load, [load]);

  const act = async (b: Booking, kind: 'Confirmed' | 'Rejected' | 'Cancelled') => {
    const verb = kind === 'Confirmed' ? 'Approve' : kind === 'Rejected' ? 'Reject' : 'Cancel';
    if (!window.confirm(`${verb} booking ${b.bookingId}?`)) return;
    try {
      if (kind === 'Cancelled') await api.put(`/bookings/${b._id}/cancel`);
      else await api.put(`/bookings/${b._id}/status`, { status: kind });
      load();
    } catch (e) {
      setError(errMsg(e));
    }
  };

  return (
    <div>
      <h1>All Bookings</h1>
      <div className="card row gap wrap">
        <label>Status<select value={status} onChange={(e) => setStatus(e.target.value)}>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select></label>
        <label>Date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        {date && <button className="btn" onClick={() => setDate('')}>Clear date</button>}
      </div>
      {error && <div className="alert error">{error}</div>}
      {list === null ? <p className="muted">Loading…</p> : list.length === 0 ? <div className="card muted">No bookings found.</div> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>ID</th><th>User</th><th>Facility</th><th>Date</th><th>Time</th><th>People</th><th>Purpose</th><th>Status</th><th /></tr></thead>
            <tbody>
              {list.map((b) => (
                <tr key={b._id}>
                  <td className="mono">{b.bookingId}</td>
                  <td>{b.user?.name}<br /><span className="muted small">{b.user?.email}</span></td>
                  <td>{b.facility?.name}</td>
                  <td>{fmtDate(b.date)}</td>
                  <td>{fmtRange(b.startTime, b.endTime)}</td>
                  <td>{b.participants}</td>
                  <td>{b.purpose}</td>
                  <td><StatusBadge status={b.status} /></td>
                  <td className="row gap nowrap">
                    {b.status === 'Pending' && <><button className="btn btn-primary" onClick={() => act(b, 'Confirmed')}>Approve</button><button className="btn btn-danger" onClick={() => act(b, 'Rejected')}>Reject</button></>}
                    {['Pending', 'Confirmed'].includes(b.status) && <button className="btn" onClick={() => act(b, 'Cancelled')}>Cancel</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

import { useEffect, useState } from 'react';
import api, { errMsg } from '../../api';
import type { Reports } from '../../types';
import { fmtDate } from '../../utils';

export default function AdminReports() {
  const [r, setR] = useState<Reports | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get<Reports>('/admin/reports').then((x) => setR(x.data)).catch((e) => setError(errMsg(e)));
  }, []);

  if (error) return <div className="alert error">{error}</div>;
  if (!r) return <p className="muted">Loading…</p>;

  const maxDay = Math.max(1, ...r.perDay.map((d) => d.count));
  const maxFac = Math.max(1, ...r.perFacility.map((f) => f.total));

  return (
    <div>
      <h1>Booking Reports</h1>

      <div className="card">
        <h3>Bookings by status</h3>
        <div className="row gap wrap">
          {Object.entries(r.byStatus).map(([k, v]) => <span key={k} className={`badge badge-${k.toLowerCase()}`}>{k}: {v}</span>)}
          {Object.keys(r.byStatus).length === 0 && <span className="muted">No bookings yet.</span>}
        </div>
      </div>

      <div className="card">
        <h3>Bookings per day (last 14 days)</h3>
        <div className="bars">
          {r.perDay.map((d) => (
            <div key={d.date} className="bar-col" title={`${fmtDate(d.date)}: ${d.count}`}>
              <span className="small">{d.count}</span>
              <div className="bar" style={{ height: `${(d.count / maxDay) * 100}px` }} />
              <span className="small muted">{d.date.slice(8)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h3>Facility usage</h3>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Facility</th><th>Type</th><th>Total</th><th>Active/Done</th><th>Cancelled</th><th>Hours booked</th><th /></tr></thead>
            <tbody>
              {r.perFacility.map((f) => (
                <tr key={f.facility}>
                  <td>{f.facility}</td><td>{f.type}</td><td>{f.total}</td><td>{f.active}</td><td>{f.cancelled}</td><td>{f.hoursBooked.toFixed(1)}</td>
                  <td style={{ width: 160 }}><div className="hbar" style={{ width: `${(f.total / maxFac) * 100}%` }} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

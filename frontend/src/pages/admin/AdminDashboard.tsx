import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errMsg } from '../../api';
import type { Stats } from '../../types';

export default function AdminDashboard() {
  const [s, setS] = useState<Stats | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get<Stats>('/admin/stats').then((r) => setS(r.data)).catch((e) => setError(errMsg(e)));
  }, []);

  const cards: [string, number | undefined, string][] = [
    ['Total Facilities', s?.totalFacilities, 'c-blue'],
    ['Total Bookings', s?.totalBookings, 'c-indigo'],
    ['Pending Bookings', s?.pendingBookings, 'c-amber'],
    ['Confirmed Bookings', s?.confirmedBookings, 'c-green'],
    ['Cancelled Bookings', s?.cancelledBookings, 'c-red'],
  ];

  return (
    <div>
      <h1>Admin Dashboard</h1>
      {error && <div className="alert error">{error}</div>}
      <div className="grid stats">
        {cards.map(([label, value, cls]) => (
          <div key={label} className={`card stat ${cls}`}>
            <div className="stat-num">{value ?? '–'}</div>
            <div className="muted">{label}</div>
          </div>
        ))}
      </div>
      {s && <p className="muted">Today: {s.todayBookings} active booking(s) · {s.totalUsers} users · {s.activeFacilities} active facilities · {s.completedBookings} completed · {s.rejectedBookings} rejected</p>}
      <div className="row gap wrap">
        <Link className="btn btn-primary" to="/admin/bookings">{s && s.pendingBookings > 0 ? `Review ${s.pendingBookings} pending` : 'View bookings'}</Link>
        <Link className="btn" to="/admin/facilities">Manage facilities</Link>
        <Link className="btn" to="/admin/reports">Reports</Link>
      </div>
    </div>
  );
}

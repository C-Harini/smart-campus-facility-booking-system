import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';

export default function Navbar() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const admin = user?.role === 'admin';
  const link = ({ isActive }: { isActive: boolean }) => (isActive ? 'active' : '');

  return (
    <header className="navbar">
      <div className="nav-inner">
        <span className="brand">🏛️ Campus Booking</span>
        <nav>
          {admin ? (
            <>
              <NavLink to="/admin" end className={link}>Dashboard</NavLink>
              <NavLink to="/admin/facilities" className={link}>Facilities</NavLink>
              <NavLink to="/admin/bookings" className={link}>Bookings</NavLink>
              <NavLink to="/admin/users" className={link}>Users</NavLink>
              <NavLink to="/admin/reports" className={link}>Reports</NavLink>
            </>
          ) : (
            <>
              <NavLink to="/" end className={link}>Dashboard</NavLink>
              <NavLink to="/facilities" className={link}>Facilities</NavLink>
              <NavLink to="/availability" className={link}>Availability</NavLink>
              <NavLink to="/my-bookings" className={link}>My Bookings</NavLink>
            </>
          )}
        </nav>
        <div className="nav-user">
          <span className="muted small">{user?.name} · {user?.role}</span>
          <button
            className="btn btn-ghost"
            onClick={() => {
              logout();
              nav('/login');
            }}
          >
            Logout
          </button>
        </div>
      </div>
    </header>
  );
}

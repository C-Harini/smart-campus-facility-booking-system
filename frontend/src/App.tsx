import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth';
import Navbar from './components/Navbar';
import ChatWidget from './components/ChatWidget';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import Facilities from './pages/Facilities';
import BookFacility from './pages/BookFacility';
import MyBookings from './pages/MyBookings';
import CheckAvailability from './pages/CheckAvailability';
import AdminDashboard from './pages/admin/AdminDashboard';
import AdminFacilities from './pages/admin/AdminFacilities';
import AdminBookings from './pages/admin/AdminBookings';
import AdminUsers from './pages/admin/AdminUsers';
import AdminReports from './pages/admin/AdminReports';

function Protected({ admin = false }: { admin?: boolean }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="center muted">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (admin && user.role !== 'admin') return <Navigate to="/" replace />;
  return <Outlet />;
}

function Layout() {
  return (
    <>
      <Navbar />
      <main className="container">
        <Outlet />
      </main>
      <ChatWidget />
    </>
  );
}

function Home() {
  const { user } = useAuth();
  return user?.role === 'admin' ? <Navigate to="/admin" replace /> : <Dashboard />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route element={<Protected />}>
        <Route element={<Layout />}>
          <Route path="/" element={<Home />} />
          <Route path="/facilities" element={<Facilities />} />
          <Route path="/facilities/:id/book" element={<BookFacility />} />
          <Route path="/my-bookings" element={<MyBookings />} />
          <Route path="/availability" element={<CheckAvailability />} />
          <Route element={<Protected admin />}>
            <Route path="/admin" element={<AdminDashboard />} />
            <Route path="/admin/facilities" element={<AdminFacilities />} />
            <Route path="/admin/bookings" element={<AdminBookings />} />
            <Route path="/admin/users" element={<AdminUsers />} />
            <Route path="/admin/reports" element={<AdminReports />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

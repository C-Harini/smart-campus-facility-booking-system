import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { errMsg } from '../api';

export default function Register() {
  const { user, register } = useAuth();
  const nav = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '', department: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await register(form);
      nav('/');
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <form className="card auth-card" onSubmit={submit}>
        <h1>Create account</h1>
        {error && <div className="alert error">{error}</div>}
        <label>Full name<input value={form.name} onChange={set('name')} required /></label>
        <label>Email<input type="email" value={form.email} onChange={set('email')} required /></label>
        <label>Department<input value={form.department} onChange={set('department')} placeholder="e.g. CSE" /></label>
        <label>Password (min 6 characters)<input type="password" value={form.password} onChange={set('password')} minLength={6} required /></label>
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Register'}</button>
        <p className="small">Already registered? <Link to="/login">Login</Link></p>
      </form>
    </div>
  );
}

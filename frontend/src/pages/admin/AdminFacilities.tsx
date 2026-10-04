import { useCallback, useEffect, useState, type FormEvent } from 'react';
import api, { errMsg } from '../../api';
import type { Facility } from '../../types';
import { FACILITY_TYPES, WEEK_DAYS, fmtRange } from '../../utils';

type Form = Omit<Facility, '_id' | 'equipment'> & { _id?: string; equipment: string };

const blank: Form = {
  name: '', type: 'Classroom', location: '', capacity: 30, description: '', equipment: '',
  availableDays: WEEK_DAYS.slice(0, 5), openingTime: '09:00', closingTime: '17:00',
  slotDuration: 60, minDuration: 60, maxDuration: 240, requiresApproval: true, status: 'Active', image: '',
};

export default function AdminFacilities() {
  const [list, setList] = useState<Facility[]>([]);
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get<Facility[]>('/facilities', { params: { status: 'All' } }).then((r) => setList(r.data)).catch((e) => setError(errMsg(e)));
  }, []);
  useEffect(load, [load]);

  const edit = (f: Facility) => { setError(''); setForm({ ...f, equipment: f.equipment.join(', ') }); };
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const toggleDay = (d: string) => form && set('availableDays', form.availableDays.includes(d) ? form.availableDays.filter((x) => x !== d) : [...form.availableDays, d]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setBusy(true);
    setError('');
    const { _id, ...rest } = form;
    try {
      if (_id) await api.put(`/facilities/${_id}`, rest);
      else await api.post('/facilities', rest);
      setForm(null);
      load();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const disable = async (f: Facility) => {
    if (!window.confirm(`Disable ${f.name}? Users will no longer be able to book it.`)) return;
    try { await api.delete(`/facilities/${f._id}`); load(); } catch (e) { setError(errMsg(e)); }
  };
  const enable = async (f: Facility) => {
    try { await api.put(`/facilities/${f._id}`, { status: 'Active' }); load(); } catch (e) { setError(errMsg(e)); }
  };

  return (
    <div>
      <div className="row between"><h1>Facilities</h1><button className="btn btn-primary" onClick={() => { setError(''); setForm({ ...blank }); }}>+ Add facility</button></div>
      {error && <div className="alert error">{error}</div>}

      {form && (
        <form className="card" onSubmit={save}>
          <h3>{form._id ? 'Edit facility' : 'New facility'}</h3>
          <div className="form-grid">
            <label>Name<input value={form.name} onChange={(e) => set('name', e.target.value)} required /></label>
            <label>Type<select value={form.type} onChange={(e) => set('type', e.target.value)}>{FACILITY_TYPES.map((t) => <option key={t}>{t}</option>)}</select></label>
            <label>Building / location<input value={form.location} onChange={(e) => set('location', e.target.value)} required /></label>
            <label>Capacity<input type="number" min={1} value={form.capacity} onChange={(e) => set('capacity', Number(e.target.value))} required /></label>
            <label>Opening time<input type="time" step={1800} value={form.openingTime} onChange={(e) => set('openingTime', e.target.value)} required /></label>
            <label>Closing time<input type="time" step={1800} value={form.closingTime} onChange={(e) => set('closingTime', e.target.value)} required /></label>
            <label>Slot length (min)<input type="number" step={30} min={30} value={form.slotDuration} onChange={(e) => set('slotDuration', Number(e.target.value))} /></label>
            <label>Min booking (min)<input type="number" step={30} min={30} value={form.minDuration} onChange={(e) => set('minDuration', Number(e.target.value))} /></label>
            <label>Max booking (min)<input type="number" step={30} min={30} value={form.maxDuration} onChange={(e) => set('maxDuration', Number(e.target.value))} /></label>
            <label>Status<select value={form.status} onChange={(e) => set('status', e.target.value as Form['status'])}><option>Active</option><option>Inactive</option><option>Maintenance</option></select></label>
            <label className="span2">Equipment (comma separated)<input value={form.equipment} onChange={(e) => set('equipment', e.target.value)} placeholder="Projector, AC, Microphone" /></label>
            <label className="span2">Image URL<input value={form.image} onChange={(e) => set('image', e.target.value)} placeholder="https://…" /></label>
            <label className="span2">Description<textarea rows={2} value={form.description} onChange={(e) => set('description', e.target.value)} /></label>
          </div>
          <div className="row gap wrap days">
            <strong>Available days:</strong>
            {WEEK_DAYS.map((d) => (
              <label key={d} className="check"><input type="checkbox" checked={form.availableDays.includes(d)} onChange={() => toggleDay(d)} />{d.slice(0, 3)}</label>
            ))}
          </div>
          <label className="check"><input type="checkbox" checked={form.requiresApproval} onChange={(e) => set('requiresApproval', e.target.checked)} /> Bookings need admin approval</label>
          <div className="row gap"><button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button><button type="button" className="btn" onClick={() => setForm(null)}>Cancel</button></div>
        </form>
      )}

      <div className="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Type</th><th>Location</th><th>Cap.</th><th>Hours</th><th>Days</th><th>Approval</th><th>Status</th><th /></tr></thead>
          <tbody>
            {list.map((f) => (
              <tr key={f._id}>
                <td>{f.name}</td><td>{f.type}</td><td>{f.location}</td><td>{f.capacity}</td>
                <td>{fmtRange(f.openingTime, f.closingTime)}</td>
                <td>{f.availableDays.map((d) => d.slice(0, 2)).join(' ')}</td>
                <td>{f.requiresApproval ? 'Yes' : 'No'}</td>
                <td><span className={`badge badge-${f.status === 'Active' ? 'confirmed' : f.status === 'Maintenance' ? 'pending' : 'cancelled'}`}>{f.status}</span></td>
                <td className="row gap nowrap">
                  <button className="btn" onClick={() => edit(f)}>Edit</button>
                  {f.status === 'Active' ? <button className="btn btn-danger" onClick={() => disable(f)}>Disable</button> : <button className="btn" onClick={() => enable(f)}>Enable</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

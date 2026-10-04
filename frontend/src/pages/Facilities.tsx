import { useEffect, useState } from 'react';
import api, { errMsg } from '../api';
import type { Facility } from '../types';
import { FACILITY_TYPES } from '../utils';
import FacilityCard from '../components/FacilityCard';

export default function Facilities() {
  const [q, setQ] = useState('');
  const [type, setType] = useState('All');
  const [minCapacity, setMinCapacity] = useState('');
  const [list, setList] = useState<Facility[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const t = setTimeout(() => {
      api
        .get<Facility[]>('/facilities', { params: { q: q || undefined, type, minCapacity: minCapacity || undefined } })
        .then((r) => {
          setList(r.data);
          setError('');
        })
        .catch((e) => setError(errMsg(e)));
    }, 250);
    return () => clearTimeout(t);
  }, [q, type, minCapacity]);

  return (
    <div>
      <h1>Campus Facilities</h1>
      <div className="card row gap wrap filters">
        <input placeholder="Search name, location, equipment…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option>All</option>
          {FACILITY_TYPES.map((t) => <option key={t}>{t}</option>)}
        </select>
        <input type="number" min={1} placeholder="Min capacity" value={minCapacity} onChange={(e) => setMinCapacity(e.target.value)} />
      </div>
      {error && <div className="alert error">{error}</div>}
      {list === null ? <p className="muted">Loading…</p> : list.length === 0 ? <p className="muted">No facilities match your search.</p> : (
        <div className="grid">{list.map((f) => <FacilityCard key={f._id} f={f} />)}</div>
      )}
    </div>
  );
}

import { Link } from 'react-router-dom';
import type { Facility } from '../types';
import { TYPE_ICON, fmtRange } from '../utils';

export default function FacilityCard({ f }: { f: Facility }) {
  return (
    <div className="card facility">
      {f.image ? <img src={f.image} alt={f.name} className="facility-img" /> : <div className="facility-img placeholder">{TYPE_ICON[f.type] || '🏢'}</div>}
      <div className="facility-body">
        <h3>{f.name}</h3>
        <p className="muted small">{f.type} · {f.location}</p>
        <p className="small">👥 Capacity {f.capacity}</p>
        <p className="small">🕑 {fmtRange(f.openingTime, f.closingTime)}</p>
        <p className="small muted">{f.availableDays.length === 7 ? 'Every day' : f.availableDays.map((d) => d.slice(0, 3)).join(', ')}</p>
        {f.equipment.length > 0 && <p className="small muted">🔧 {f.equipment.join(', ')}</p>}
        {f.requiresApproval && <p className="small warn">Requires admin approval</p>}
        <Link className="btn btn-primary" to={`/facilities/${f._id}/book`}>Book</Link>
      </div>
    </div>
  );
}

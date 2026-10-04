import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errMsg } from '../api';
import type { Availability, Facility } from '../types';
import { fmtDateLong, todayStr } from '../utils';
import SlotGrid from '../components/SlotGrid';

export default function CheckAvailability() {
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [id, setId] = useState('');
  const [date, setDate] = useState(todayStr());
  const [avail, setAvail] = useState<Availability | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get<Facility[]>('/facilities').then((r) => {
      setFacilities(r.data);
      if (r.data.length) setId(r.data[0]._id);
    }).catch((e) => setError(errMsg(e)));
  }, []);

  useEffect(() => {
    if (!id) return;
    setAvail(null);
    api.get<Availability>(`/facilities/${id}/availability`, { params: { date } })
      .then((r) => { setAvail(r.data); setError(''); })
      .catch((e) => setError(errMsg(e)));
  }, [id, date]);

  return (
    <div>
      <h1>Check Availability</h1>
      <div className="card row gap wrap">
        <label>Facility
          <select value={id} onChange={(e) => setId(e.target.value)}>
            {facilities.map((f) => <option key={f._id} value={f._id}>{f.name} ({f.type})</option>)}
          </select>
        </label>
        <label>Date<input type="date" min={todayStr()} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} /></label>
      </div>
      {error && <div className="alert error">{error}</div>}
      {avail && (
        <div className="card">
          <h3>{avail.facilityName} · {fmtDateLong(date)}</h3>
          {!avail.open ? <div className="alert">{avail.reason}</div> : <SlotGrid slots={avail.slots} />}
          {avail.open && avail.freeRanges.length > 0 && <Link className="btn btn-primary" to={`/facilities/${id}/book?date=${date}`}>Book this day</Link>}
        </div>
      )}
    </div>
  );
}

import { useCallback, useEffect, useState } from 'react';
import api, { errMsg } from '../../api';
import { useAuth } from '../../auth';
import type { Role, User } from '../../types';
import { fmtDate } from '../../utils';

export default function AdminUsers() {
  const { user: me } = useAuth();
  const [list, setList] = useState<User[]>([]);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api.get<User[]>('/users').then((r) => setList(r.data)).catch((e) => setError(errMsg(e)));
  }, []);
  useEffect(load, [load]);

  const setRole = async (u: User, role: Role) => {
    try { await api.put(`/users/${u._id}`, { role }); load(); } catch (e) { setError(errMsg(e)); }
  };
  const remove = async (u: User) => {
    if (!window.confirm(`Delete user ${u.name}?`)) return;
    try { await api.delete(`/users/${u._id}`); load(); } catch (e) { setError(errMsg(e)); }
  };

  return (
    <div>
      <h1>Users</h1>
      {error && <div className="alert error">{error}</div>}
      <div className="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Email</th><th>Department</th><th>Role</th><th>Joined</th><th /></tr></thead>
          <tbody>
            {list.map((u) => (
              <tr key={u._id}>
                <td>{u.name}</td><td>{u.email}</td><td>{u.department || '–'}</td>
                <td>
                  <select value={u.role} disabled={u._id === me?._id} onChange={(e) => setRole(u, e.target.value as Role)}>
                    <option value="student">student</option><option value="admin">admin</option>
                  </select>
                </td>
                <td>{u.createdAt ? fmtDate(u.createdAt.slice(0, 10)) : '–'}</td>
                <td>{u._id !== me?._id && <button className="btn btn-danger" onClick={() => remove(u)}>Delete</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

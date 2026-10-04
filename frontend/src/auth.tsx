import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import api from './api';
import type { User } from './types';

interface AuthCtx {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  register: (data: { name: string; email: string; password: string; department?: string }) => Promise<User>;
  logout: () => void;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(Boolean(localStorage.getItem('token')));

  useEffect(() => {
    if (!localStorage.getItem('token')) return;
    api
      .get<{ user: User }>('/auth/me')
      .then((r) => setUser(r.data.user))
      .catch(() => localStorage.removeItem('token'))
      .finally(() => setLoading(false));
  }, []);

  const finish = (token: string, u: User) => {
    localStorage.setItem('token', token);
    setUser(u);
    return u;
  };

  const login = useCallback(async (email: string, password: string) => {
    const r = await api.post<{ token: string; user: User }>('/auth/login', { email, password });
    return finish(r.data.token, r.data.user);
  }, []);

  const register = useCallback(async (data: { name: string; email: string; password: string; department?: string }) => {
    const r = await api.post<{ token: string; user: User }>('/auth/register', data);
    return finish(r.data.token, r.data.user);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('token');
    setUser(null);
  }, []);

  return <Ctx.Provider value={{ user, loading, login, register, logout }}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth must be used inside AuthProvider');
  return c;
}

import axios from 'axios';

const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || '/api' });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (error) => {
    const url: string = error.config?.url || '';
    if (error.response?.status === 401 && !url.startsWith('/auth/login') && !url.startsWith('/auth/register')) {
      localStorage.removeItem('token');
      if (!location.pathname.startsWith('/login')) location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export function errMsg(e: unknown): string {
  if (axios.isAxiosError(e)) return (e.response?.data as { message?: string })?.message || e.message;
  return e instanceof Error ? e.message : 'Something went wrong';
}

export default api;

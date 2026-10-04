export const pad = (n: number) => String(n).padStart(2, '0');

/** Today's date in the browser's local timezone as YYYY-MM-DD */
export function todayStr(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fmtTime(t: string): string {
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}:${pad(m)} ${h >= 12 ? 'PM' : 'AM'}`;
}

export const fmtRange = (a: string, b: string) => `${fmtTime(a)} – ${fmtTime(b)}`;

export function fmtDate(d: string): string {
  return new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function fmtDateLong(d: string): string {
  return new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export const WEEK_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const FACILITY_TYPES = [
  'Classroom', 'Computer Lab', 'Seminar Hall', 'Auditorium', 'Conference Room',
  'Sports Ground', 'Basketball Court', 'Volleyball Court', 'Indoor Hall', 'Meeting Room',
];

export const TYPE_ICON: Record<string, string> = {
  Classroom: '🏫', 'Computer Lab': '💻', 'Seminar Hall': '🎤', Auditorium: '🎭', 'Conference Room': '🧑‍💼',
  'Sports Ground': '⚽', 'Basketball Court': '🏀', 'Volleyball Court': '🏐', 'Indoor Hall': '🏸', 'Meeting Room': '🗂️',
};

export const notifyBookingsChanged = () => window.dispatchEvent(new Event('bookings:changed'));

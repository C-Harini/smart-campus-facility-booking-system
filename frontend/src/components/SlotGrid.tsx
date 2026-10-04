import type { Slot } from '../types';
import { fmtRange } from '../utils';

interface Props {
  slots: Slot[];
  selection?: [number, number] | null;
  onPick?: (index: number) => void;
}

export default function SlotGrid({ slots, selection, onPick }: Props) {
  return (
    <div className="slots">
      {slots.map((s, i) => {
        const selected = selection ? i >= selection[0] && i <= selection[1] : false;
        const cls = ['slot', s.available ? 'free' : 'busy', selected ? 'selected' : ''].join(' ');
        return (
          <button
            key={s.startTime}
            type="button"
            className={cls}
            disabled={!s.available || !onPick}
            onClick={() => onPick?.(i)}
            title={s.available ? 'Available' : s.reason === 'past' ? 'Time has passed' : 'Already booked'}
          >
            {fmtRange(s.startTime, s.endTime)}
            {!s.available && <small>{s.reason === 'past' ? 'past' : 'booked'}</small>}
          </button>
        );
      })}
    </div>
  );
}

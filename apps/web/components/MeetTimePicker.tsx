'use client';

import { useEffect, useState } from 'react';

// 8:00 AM → 9:00 PM in 30-minute slots, Calendly-style.
const SLOTS: string[] = (() => {
  const out: string[] = [];
  for (let m = 8 * 60; m <= 21 * 60; m += 30) {
    const h = Math.floor(m / 60);
    const mm = m % 60;
    const ampm = h < 12 ? 'AM' : 'PM';
    const hr = ((h + 11) % 12) + 1;
    out.push(`${hr}:${mm === 0 ? '00' : mm} ${ampm}`);
  }
  return out;
})();

function todayStr(): string {
  const d = new Date();
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 10);
}

/**
 * Pick a meeting date + time slot. Produces a human label (e.g. "Sat, Jun 14 · 4:00 PM")
 * via onChange, which the seller's listing stores as the proposed meeting time.
 */
export default function MeetTimePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [date, setDate] = useState('');
  const [slot, setSlot] = useState('');

  useEffect(() => {
    if (!date || !slot) return;
    const d = new Date(`${date}T00:00:00`);
    const label = d.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
    onChange(`${label} · ${slot}`);
    // onChange identity from the parent isn't stable; intentionally excluded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, slot]);

  return (
    <div className="space-y-3">
      <input
        type="date"
        min={todayStr()}
        className="input"
        value={date}
        onChange={(e) => setDate(e.target.value)}
      />
      {date && (
        <div className="grid max-h-44 grid-cols-3 gap-2 overflow-y-auto pr-1">
          {SLOTS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSlot(s)}
              className={`choice !py-2 text-sm ${slot === s ? 'choice-on' : 'choice-off'}`}
            >
              {s}
            </button>
          ))}
        </div>
      )}
      {value && (
        <p className="text-xs text-zinc-400">
          Selected: <span className="text-zinc-200">{value}</span>
        </p>
      )}
    </div>
  );
}

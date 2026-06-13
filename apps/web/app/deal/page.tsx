'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function DealIndexPage() {
  const router = useRouter();
  const [id, setId] = useState('');

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold">Open a deal</h1>
      <div className="card space-y-3">
        <label className="label" htmlFor="deal">
          Deal #
        </label>
        <input
          id="deal"
          inputMode="numeric"
          className="input"
          value={id}
          onChange={(e) => setId(e.target.value.replace(/[^0-9]/g, ''))}
          placeholder="0"
        />
        <button
          className="btn-primary"
          disabled={id === ''}
          onClick={() => router.push(`/deal/${id}`)}
        >
          Open deal
        </button>
      </div>
    </div>
  );
}

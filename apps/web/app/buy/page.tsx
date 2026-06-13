'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function BuyIndexPage() {
  const router = useRouter();
  const [id, setId] = useState('');

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold">Buy an item</h1>
      <p className="text-slate-600">
        Open the listing the seller shared with you.
      </p>
      <div className="card space-y-3">
        <label className="label" htmlFor="listing">
          Listing #
        </label>
        <input
          id="listing"
          inputMode="numeric"
          className="input"
          value={id}
          onChange={(e) => setId(e.target.value.replace(/[^0-9]/g, ''))}
          placeholder="0"
        />
        <button
          className="btn-primary"
          disabled={id === ''}
          onClick={() => router.push(`/buy/${id}`)}
        >
          Open listing
        </button>
      </div>
    </div>
  );
}

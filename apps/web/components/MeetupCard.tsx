'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  getCoordination,
  shareCoordination,
  type Coordination,
} from '@/lib/backend';

type Role = 'buyer' | 'seller' | 'observer';

const mapsLink = (lat: number, lng: number) => `https://www.google.com/maps?q=${lat},${lng}`;
const mapsEmbed = (lat: number, lng: number) =>
  `https://maps.google.com/maps?q=${lat},${lng}&z=15&output=embed`;

function timeAgo(ts?: number) {
  if (!ts) return '';
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  return `${Math.round(s / 60)}m ago`;
}

/**
 * Live meetup coordination for a deal: shows the counterparty's shared location on a
 * (keyless) Google Maps embed + directions link, their phone, and lets you share your
 * own live location. Polls the backend so both phones stay roughly in sync.
 */
export default function MeetupCard({
  dealId,
  role,
  meetAddress,
}: {
  dealId: bigint;
  role: Role;
  meetAddress?: string | null;
}) {
  const [coord, setCoord] = useState<Coordination>({ buyer: null, seller: null });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setCoord(await getCoordination(dealId));
  }, [dealId]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 8000); // keep both sides roughly live
    return () => clearInterval(t);
  }, [refresh]);

  function shareLocation() {
    if (role === 'observer') return;
    if (!navigator.geolocation) return setErr('Location isn’t available in this browser.');
    setBusy(true);
    setErr(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        await shareCoordination(dealId, role, {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
        setBusy(false);
        refresh();
      },
      () => {
        setErr('Could not get your location (permission denied?).');
        setBusy(false);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  const other = role === 'buyer' ? coord.seller : coord.buyer;
  const mine = role === 'buyer' ? coord.buyer : coord.seller;
  const otherLabel = role === 'buyer' ? 'Seller' : 'Buyer';
  const contactPhone = other?.phone ?? (role === 'buyer' ? coord.seller?.phone : null);

  return (
    <div className="card space-y-3">
      <div className="font-semibold">Meet up</div>

      {meetAddress && (
        <div className="surface text-sm text-zinc-200">📍 {meetAddress}</div>
      )}

      {other?.lat != null && other?.lng != null ? (
        <div className="space-y-2">
          <div className="text-xs text-zinc-400">
            {otherLabel}&apos;s live location · updated {timeAgo(other.updatedAt)}
          </div>
          <iframe
            title={`${otherLabel} location`}
            src={mapsEmbed(other.lat, other.lng)}
            className="h-44 w-full rounded-xl border border-white/10"
            loading="lazy"
          />
          <a
            className="btn-secondary"
            href={mapsLink(other.lat, other.lng)}
            target="_blank"
            rel="noreferrer"
          >
            Open in Google Maps ↗
          </a>
        </div>
      ) : (
        <div className="text-sm text-zinc-500">
          {otherLabel} hasn&apos;t shared a live location yet.
        </div>
      )}

      {contactPhone && (
        <a className="btn-secondary" href={`tel:${contactPhone}`}>
          📞 Call {role === 'buyer' ? 'seller' : 'buyer'} · {contactPhone}
        </a>
      )}

      {role !== 'observer' && (
        <button className="btn-primary" onClick={shareLocation} disabled={busy}>
          {busy
            ? 'Sharing…'
            : mine?.lat != null
              ? 'Update my live location'
              : 'Share my live location'}
        </button>
      )}
      {mine?.lat != null && (
        <p className="text-center text-xs text-zinc-500">
          You&apos;re sharing your location · updated {timeAgo(mine.updatedAt)}
        </p>
      )}
      {err && <div className="text-sm text-rose-300">{err}</div>}
    </div>
  );
}

'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@handoff/auth';
import {
  getCoordination,
  getListingMeta,
  shareCoordination,
  type Coordination,
  type ListingMeta,
} from '@/lib/backend';

type Role = 'buyer' | 'seller' | 'observer';

const mapsLink = (lat: number, lng: number) => `https://www.google.com/maps?q=${lat},${lng}`;
const mapsEmbed = (lat: number, lng: number) =>
  `https://maps.google.com/maps?q=${lat},${lng}&z=15&output=embed`;

function timeAgo(ts?: number) {
  if (!ts) return '';
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  return s < 60 ? `${s}s ago` : `${Math.round(s / 60)}m ago`;
}

/**
 * Live meetup coordination: the agreed plan (from the listing), the counterparty's live
 * location + contact, and controls to share your own location/phone/email and propose a
 * new spot or time. Polls the backend so both phones stay roughly in sync.
 */
export default function MeetupCard({ dealId, role }: { dealId: bigint; role: Role }) {
  const { email } = useAuth();
  const [coord, setCoord] = useState<Coordination>({ buyer: null, seller: null });
  const [meta, setMeta] = useState<ListingMeta | null>(null);
  const [phoneInput, setPhoneInput] = useState('');
  const [noteInput, setNoteInput] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const c = await getCoordination(dealId);
    setCoord(c);
    if (c.listingId) setMeta(await getListingMeta(c.listingId));
  }, [dealId]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 8000);
    return () => clearInterval(t);
  }, [refresh]);

  if (role === 'observer') return null;

  const other = role === 'buyer' ? coord.seller : coord.buyer;
  const mine = role === 'buyer' ? coord.buyer : coord.seller;
  const otherLabel = role === 'buyer' ? 'Seller' : 'Buyer';
  const otherPhone = other?.phone ?? (role === 'buyer' ? meta?.sellerPhone : null);
  const otherEmail = other?.email ?? (role === 'buyer' ? meta?.sellerEmail : null);

  function shareLocation() {
    if (!navigator.geolocation) return setErr('Location isn’t available in this browser.');
    setBusy('loc');
    setErr(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        await shareCoordination(dealId, role as 'buyer' | 'seller', {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
        setBusy(null);
        refresh();
      },
      () => {
        setErr('Could not get your location (permission denied?).');
        setBusy(null);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  async function shareContact() {
    setBusy('contact');
    await shareCoordination(dealId, role as 'buyer' | 'seller', {
      phone: phoneInput.trim() || undefined,
      email: email || undefined,
    });
    setBusy(null);
    refresh();
  }

  async function propose() {
    if (!noteInput.trim()) return;
    setBusy('note');
    await shareCoordination(dealId, role as 'buyer' | 'seller', { note: noteInput.trim() });
    setNoteInput('');
    setBusy(null);
    refresh();
  }

  return (
    <div className="card space-y-3">
      <div className="font-semibold">Meet up</div>

      {(meta?.meetAddress || meta?.meetTime || meta?.notes) && (
        <div className="surface space-y-1 text-sm text-zinc-200">
          {meta?.meetAddress && <div>📍 {meta.meetAddress}</div>}
          {meta?.meetTime && <div>🕒 {meta.meetTime}</div>}
          {meta?.notes && (
            <div className="text-zinc-300">
              <span className="text-zinc-500">Seller&apos;s note:</span> {meta.notes}
            </div>
          )}
        </div>
      )}

      {other?.lat != null && other?.lng != null ? (
        <div className="space-y-2">
          <div className="text-xs text-zinc-400">
            {otherLabel}&apos;s live location · {timeAgo(other.updatedAt)}
          </div>
          <iframe
            title={`${otherLabel} location`}
            src={mapsEmbed(other.lat, other.lng)}
            className="h-44 w-full rounded-xl border border-white/10"
            loading="lazy"
          />
          <a className="btn-secondary" href={mapsLink(other.lat, other.lng)} target="_blank" rel="noreferrer">
            Open in Google Maps ↗
          </a>
        </div>
      ) : (
        <div className="text-sm text-zinc-500">{otherLabel} hasn&apos;t shared a live location yet.</div>
      )}

      {otherPhone && (
        <a className="btn-secondary" href={`tel:${otherPhone}`}>📞 {otherLabel} · {otherPhone}</a>
      )}
      {otherEmail && (
        <a className="btn-secondary" href={`mailto:${otherEmail}`}>✉️ {otherLabel} · {otherEmail}</a>
      )}
      {other?.note && (
        <div className="surface text-sm text-amber-200">💬 {otherLabel} proposes: {other.note}</div>
      )}

      <div className="space-y-2 border-t border-white/10 pt-3">
        <button className="btn-primary" onClick={shareLocation} disabled={busy === 'loc'}>
          {busy === 'loc'
            ? 'Sharing…'
            : mine?.lat != null
              ? 'Update my live location'
              : 'Share my live location'}
        </button>
        <div className="flex gap-2">
          <input
            className="input"
            value={phoneInput}
            onChange={(e) => setPhoneInput(e.target.value)}
            placeholder="Your phone"
            inputMode="tel"
          />
          <button className="btn-secondary !w-auto px-4" onClick={shareContact} disabled={busy === 'contact'}>
            Share
          </button>
        </div>
        <div className="flex gap-2">
          <input
            className="input"
            value={noteInput}
            onChange={(e) => setNoteInput(e.target.value)}
            placeholder="Propose a new spot or time…"
          />
          <button
            className="btn-secondary !w-auto px-4"
            onClick={propose}
            disabled={busy === 'note' || !noteInput.trim()}
          >
            Send
          </button>
        </div>
        {(mine?.phone || mine?.email) && (
          <p className="text-center text-xs text-zinc-500">
            Sharing your contact{mine?.lat != null ? ' + live location' : ''} ✓
          </p>
        )}
      </div>
      {err && <div className="text-sm text-rose-300">{err}</div>}
    </div>
  );
}

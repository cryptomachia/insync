'use client';

// Pre-deal messaging + offers for a (listing, buyer) conversation. The buyer chats with the
// listing's seller before committing — ask questions, request photos, or "Make offer". The
// seller can Accept/Decline an offer. Polls the backend so both sides stay in sync.
import { useCallback, useEffect, useRef, useState } from 'react';
import { getThread, sendMessage, type ChatMessage } from '@/lib/backend';
import { fmtUsd1e8, parseUsdToUsd1e8 } from '@/lib/format';

type Role = 'buyer' | 'seller';

export default function Chat({
  listingId,
  buyer,
  role,
  listingPriceUsd1e8,
}: {
  listingId: string;
  buyer: string;
  role: Role;
  listingPriceUsd1e8?: bigint;
}) {
  const [msgs, setMsgs] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [offerStr, setOfferStr] = useState('');
  const [showOffer, setShowOffer] = useState(false);
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(() => {
    if (!buyer) return;
    getThread(listingId, buyer).then(setMsgs).catch(() => {});
  }, [listingId, buyer]);

  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [msgs.length]);

  async function send(kind: ChatMessage['kind'], body?: string, priceUsd1e8?: string) {
    setBusy(true);
    try {
      await sendMessage(listingId, buyer, { sender: role, kind, body, priceUsd1e8 });
      load();
    } finally {
      setBusy(false);
    }
  }

  async function sendText() {
    const b = text.trim();
    if (!b) return;
    setText('');
    await send('text', b);
  }

  async function makeOffer() {
    const p = parseUsdToUsd1e8(offerStr);
    if (p <= 0n) return;
    setOfferStr('');
    setShowOffer(false);
    await send('offer', undefined, p.toString());
  }

  // The latest offer is "open" (seller can act) if nothing accepted/declined it since.
  const lastOfferIdx = msgs.map((m) => m.kind).lastIndexOf('offer');
  const openOffer =
    lastOfferIdx >= 0 &&
    !msgs.slice(lastOfferIdx + 1).some((m) => m.kind === 'accept' || m.kind === 'decline')
      ? msgs[lastOfferIdx]
      : null;
  const acceptedPrice = (() => {
    const a = [...msgs].reverse().find((m) => m.kind === 'accept');
    return a?.priceUsd1e8 ? BigInt(a.priceUsd1e8) : null;
  })();

  return (
    <div className="card space-y-3">
      <div className="text-sm font-semibold">{role === 'seller' ? 'Conversation with buyer' : 'Message the seller'}</div>

      <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
        {msgs.length === 0 ? (
          <div className="surface text-xs text-zinc-400">
            No messages yet. {role === 'buyer' ? 'Ask a question or make an offer.' : 'Waiting for the buyer.'}
          </div>
        ) : (
          msgs.map((m) => <Bubble key={m.id} m={m} mine={m.sender === role} />)
        )}
        <div ref={endRef} />
      </div>

      {/* Seller: act on an open offer */}
      {role === 'seller' && openOffer && (
        <div className="surface flex items-center justify-between gap-2 border-indigo-400/30 bg-indigo-500/10">
          <span className="text-sm">
            Buyer offered <b>{openOffer.priceUsd1e8 ? fmtUsd1e8(BigInt(openOffer.priceUsd1e8)) : ''}</b>
          </span>
          <span className="flex gap-2">
            <button
              className="rounded-lg bg-emerald-500 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
              disabled={busy}
              onClick={() => send('accept', undefined, openOffer.priceUsd1e8!)}
            >
              Accept
            </button>
            <button
              className="rounded-lg border border-white/15 px-3 py-1 text-xs font-semibold disabled:opacity-50"
              disabled={busy}
              onClick={() => send('decline')}
            >
              Decline
            </button>
          </span>
        </div>
      )}

      {/* Accepted-offer note (price coupling caveat for differing prices) */}
      {acceptedPrice != null && listingPriceUsd1e8 != null && acceptedPrice !== listingPriceUsd1e8 && (
        <div className="surface text-xs text-amber-200">
          Agreed price {fmtUsd1e8(acceptedPrice)} differs from the listed {fmtUsd1e8(listingPriceUsd1e8)}.
          {role === 'seller'
            ? ' Relist at the agreed price (My listings → Delist & relist) so the buyer is charged exactly that.'
            : ' The seller needs to relist at the agreed price before you fund.'}
        </div>
      )}

      {/* Composer */}
      <div className="flex gap-2">
        <input
          className="input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && sendText()}
          placeholder="Type a message…"
        />
        <button className="btn-secondary !w-auto px-4" onClick={sendText} disabled={busy || !text.trim()}>
          Send
        </button>
      </div>

      {role === 'buyer' &&
        (showOffer ? (
          <div className="flex gap-2">
            <input
              className="input"
              inputMode="decimal"
              value={offerStr}
              onChange={(e) => setOfferStr(e.target.value)}
              placeholder="Your offer (USD)"
            />
            <button className="btn-primary !w-auto px-4" onClick={makeOffer} disabled={busy || !offerStr}>
              Send offer
            </button>
            <button className="btn-secondary !w-auto px-3" onClick={() => setShowOffer(false)}>
              ✕
            </button>
          </div>
        ) : (
          <button className="btn-secondary" onClick={() => setShowOffer(true)}>
            💰 Make an offer
          </button>
        ))}
    </div>
  );
}

function Bubble({ m, mine }: { m: ChatMessage; mine: boolean }) {
  if (m.kind === 'accept' || m.kind === 'decline') {
    const text =
      m.kind === 'accept'
        ? `✅ Offer accepted${m.priceUsd1e8 ? ` — ${fmtUsd1e8(BigInt(m.priceUsd1e8))}` : ''}`
        : '✕ Offer declined';
    return (
      <div className="text-center">
        <span className="inline-block rounded-full bg-white/5 px-3 py-1 text-[11px] text-zinc-300">{text}</span>
      </div>
    );
  }
  const isOffer = m.kind === 'offer';
  return (
    <div className={mine ? 'flex justify-end' : 'flex justify-start'}>
      <div
        className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
          isOffer
            ? 'border border-indigo-400/40 bg-indigo-500/15 text-indigo-100'
            : mine
              ? 'bg-indigo-500 text-white'
              : 'bg-white/[0.06] text-zinc-200'
        }`}
      >
        {isOffer ? (
          <span>💰 Offer: <b>{m.priceUsd1e8 ? fmtUsd1e8(BigInt(m.priceUsd1e8)) : ''}</b></span>
        ) : (
          m.body
        )}
      </div>
    </div>
  );
}

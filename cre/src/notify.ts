// Backend notification helper (SPEC §11/§12): POST {dealId, event} to /notify.
//
// Used by the LOCAL keeper. The CRE workflow performs the equivalent POST via
// the CRE HTTPClient capability (workflow.ts) because the WASM sandbox has no
// global fetch. The payload shape is identical so the backend treats both the
// same: { dealId: string, event: string }.

export type LifecycleEvent =
  | 'ReclaimAttempt'
  | 'Reclaimed'
  | 'ReclaimFailed'
  | 'SweepStarted'
  | 'SweepCompleted'

export interface NotifyPayload {
  dealId: string
  event: LifecycleEvent | string
  detail?: string
}

/**
 * POST a lifecycle notification to the backend. Never throws — notifications
 * are best-effort and must not abort a reclaim sweep. Returns true on 2xx.
 */
export async function notifyBackend(
  backendUrl: string | undefined,
  payload: NotifyPayload,
): Promise<boolean> {
  if (!backendUrl) return false
  const url = backendUrl.replace(/\/$/, '') + '/notify'
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    return res.ok
  } catch {
    // Backend may not be running in a pure-CRE demo; that's fine.
    return false
  }
}

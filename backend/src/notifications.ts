// Notification dispatch. Today: log + store a row in sqlite. The NotificationProvider
// interface is the seam where a real push/SMS provider (Twilio, FCM, APNs, ...) drops in:
// implement `deliver` and register it via `setNotificationProvider`.
import type { HandoffDb, NotificationRow } from './db.ts';

export interface NotificationEvent {
  dealId: bigint;
  event: string;
  payload?: unknown;
}

export interface NotificationProvider {
  readonly name: string;
  // Return true if the message was accepted by the downstream provider.
  deliver(n: NotificationEvent): Promise<boolean>;
}

// Default provider: structured console log. A real provider implements the same shape.
export class LogNotificationProvider implements NotificationProvider {
  readonly name = 'log';
  async deliver(n: NotificationEvent): Promise<boolean> {
    const line = {
      provider: this.name,
      kind: 'notification',
      dealId: n.dealId.toString(),
      event: n.event,
      payload: n.payload ?? null,
      at: new Date().toISOString(),
    };
    // Structured single-line log so log shippers can parse it.
    console.log(JSON.stringify(line));
    return true;
  }
}

let provider: NotificationProvider = new LogNotificationProvider();

export function setNotificationProvider(p: NotificationProvider): void {
  provider = p;
}

export function getNotificationProvider(): NotificationProvider {
  return provider;
}

// Store the notification, then attempt delivery via the active provider. Always persists a
// row first so nothing is lost if delivery fails; marks `delivered` on success.
export async function notify(db: HandoffDb, n: NotificationEvent): Promise<NotificationRow> {
  const row = db.insertNotification(n);
  let delivered = false;
  try {
    delivered = await provider.deliver(n);
  } catch (err) {
    console.error(
      JSON.stringify({
        provider: provider.name,
        kind: 'notification_error',
        dealId: n.dealId.toString(),
        event: n.event,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
  if (delivered) {
    db.raw.prepare('UPDATE notifications SET delivered=1 WHERE id=?').run(row.id);
    row.delivered = 1;
  }
  return row;
}

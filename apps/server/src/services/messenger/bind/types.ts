import type { MessengerPlatform } from '@/config/messenger';

/**
 * How the client should present a one-click bind:
 *
 * - `qr`       — show `payload.qrValue` as a QR code to scan with the IM app
 *                (WeChat iLink). There is nothing to open on this device.
 * - `deeplink` — open `payload.url` on a phone (Telegram `t.me/<bot>?start=`,
 *                iMessage `sms:` prefilled with a code). `payload.qrValue`
 *                carries the same URL so a desktop can hand it to a phone.
 * - `oauth`    — open `payload.url` in a browser; the platform's consent
 *                screen finishes the bind (Slack, Discord).
 */
export type BindKind = 'qr' | 'deeplink' | 'oauth';

export interface BindPayload {
  /** One-time code embedded in the link, for people who need to type it. */
  code?: string;
  /** Value to render as a QR code; absent when a QR makes no sense (OAuth). */
  qrValue?: string;
  /** Where a hand-typed code goes (the iMessage pool number), when relevant. */
  recipient?: string;
  /** Link to open. Absent for `qr` (WeChat only binds through its own scanner). */
  url?: string;
}

export interface StartBindResult {
  expiresAt: number;
  kind: BindKind;
  payload: BindPayload;
  platform: MessengerPlatform;
  /** Opaque handle for `pollBind`; never reveals the code itself. */
  pollId: string;
}

export type BindFailureReason =
  | 'already_linked_to_other'
  | 'identity_unavailable'
  /** The OAuth round trip ended without an install (denied, exchange or persist failed). */
  | 'oauth_failed'
  | 'unlink_before_relink';

/**
 * Unified poll outcome. `scanned` is WeChat-only (the QR was scanned but not
 * yet confirmed on the phone).
 */
export type BindPollStatus =
  | { status: 'pending' | 'scanned' | 'expired' }
  | { linkedAt: number; platformUserId: string; status: 'linked' }
  | { reason: BindFailureReason; status: 'failed' };

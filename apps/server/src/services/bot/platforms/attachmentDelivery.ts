import type { BotMessageAttachment } from './types';

/**
 * Why one outbound attachment never reached the user.
 *
 * - `source-unavailable`: its bytes could not be materialized (no `data` /
 *   `fetchUrl`, the download was refused, failed or exceeded the cap).
 * - `over-budget-no-link`: larger than the platform accepts and no `fetchUrl`
 *   to fall back to as a download link.
 * - `upload-failed`: the platform refused the upload or the media message.
 */
export type AttachmentFailureReason =
  'over-budget-no-link' | 'source-unavailable' | 'upload-failed';

/**
 * One undelivered attachment, in the shape every platform sender reports and
 * `SendMessageState.attachmentFailures` carries back to the agent. `detail` is
 * the diagnostic part — the loader's error or the platform's `errmsg`.
 */
export interface AttachmentFailure {
  detail?: string;
  name?: string;
  reason: AttachmentFailureReason;
  type: BotMessageAttachment['type'];
}

/**
 * What every platform's attachment sender reports back. A silent per-item
 * skip is exactly how a broken download went unnoticed in production for a
 * month, so the count alone is no longer enough: callers get WHICH attachments
 * failed and WHY, and the boundary decides what to do with that.
 */
export interface AttachmentSendResult {
  delivered: number;
  failures: AttachmentFailure[];
}

export const describeAttachmentFailure = (failure: AttachmentFailure): string =>
  `"${failure.name ?? '(unnamed)'}" (${failure.type}): ${failure.reason}${
    failure.detail ? ` — ${failure.detail}` : ''
  }`;

export const summarizeAttachmentFailures = (failures: AttachmentFailure[]): string =>
  failures.map(describeAttachmentFailure).join('; ');

/**
 * ONE production-visible line per send that lost attachments. The helpers keep
 * their per-item chatter on `debug()`, which production does not enable — and
 * that is precisely why a whole-platform regression left no trace in the logs.
 * Degradation is a handled outcome, so this is `warn`, never `error`.
 */
export const warnAttachmentFailures = (scope: string, failures: AttachmentFailure[]): void => {
  if (failures.length === 0) return;
  console.warn(
    `[${scope}] ${failures.length} attachment(s) were not delivered — ${summarizeAttachmentFailures(failures)}`,
  );
};

/**
 * The attachment fields of a send state. Absent entirely when the send carried
 * no attachments, so text-only results keep their old shape.
 */
export const attachmentDeliveryState = (
  result: AttachmentSendResult | undefined,
): { attachmentFailures?: AttachmentFailure[]; attachmentsDelivered?: number } =>
  result
    ? {
        ...(result.failures.length > 0 ? { attachmentFailures: result.failures } : {}),
        attachmentsDelivered: result.delivered,
      }
    : {};

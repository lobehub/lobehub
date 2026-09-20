import type { AcceptanceStatus, ScmProvider } from '@lobechat/types';

/**
 * The comment LobeHub keeps on a tracked pull request. Modelled on Vercel's
 * bot comment: a hidden marker line that carries machine-readable identity,
 * a one-line headline, and a status table that is rewritten in place as
 * the pull request moves — one comment per pull request, never a thread.
 */

export const TRACKING_MARKER_LABEL = 'lobehub';
export const GITHUB_INTEGRATION_DOCS_URL = 'https://lobehub.com/docs/usage/integrations/github';

export interface TrackingCommentMarker {
  acceptanceId?: string;
  changeRequestId: string;
  provider: ScmProvider;
  topicId?: string;
  v: 1;
}

/**
 * A link reference definition renders as nothing on GitHub, which makes it
 * the conventional place to hide state: `[lobehub]: #<base64 json>`.
 */
export const encodeTrackingMarker = (marker: TrackingCommentMarker) =>
  `[${TRACKING_MARKER_LABEL}]: #${Buffer.from(JSON.stringify(marker)).toString('base64')}`;

export const parseTrackingMarker = (body: string): TrackingCommentMarker | null => {
  const match = new RegExp(String.raw`^\[${TRACKING_MARKER_LABEL}\]: #(\S+)`, 'm').exec(body);
  if (!match) return null;
  try {
    const parsed = JSON.parse(Buffer.from(match[1], 'base64').toString('utf8'));
    return parsed && parsed.v === 1 && typeof parsed.changeRequestId === 'string' ? parsed : null;
  } catch {
    return null;
  }
};

const ACCEPTANCE_STATUS: Record<AcceptanceStatus, string> = {
  accepted: '✅ Accepted',
  closed: '⚫ Closed',
  delivered: '🟡 Delivered',
  errored: '⚠️ Errored',
  pending: '⚪ Pending',
  planned: '⚪ Planned',
  rejected: '❌ Rejected',
  repairing: '🔧 Repairing',
  verifying: '🔄 Verifying',
};

const NOTIFICATION_REASON: Record<string, string> = {
  ci_failed: 'CI failed',
  review_changes_requested: 'Changes requested',
  review_commented: 'Review comment',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `Sep 20, 2026 3:12pm`, in UTC, the way Vercel prints its Updated column. */
export const formatUtc = (date: Date) => {
  const hours24 = date.getUTCHours();
  const hours = hours24 % 12 || 12;
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  const meridiem = hours24 < 12 ? 'am' : 'pm';
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()} ${hours}:${minutes}${meridiem}`;
};

/** Table cells cannot contain a pipe or a line break. */
const cell = (text: string) =>
  text
    .replaceAll('|', '\\|')
    .replaceAll(/\s*\n\s*/g, ' ')
    .trim();

export interface TrackingCommentInput {
  acceptance?: { id: string; status: AcceptanceStatus; url: string } | null;
  conversation?: { title?: string | null; url: string } | null;
  marker: TrackingCommentMarker;
  /** How often the agent has been notified about this pull request, and why last. */
  notification?: { count: number; max: number; reason?: string } | null;
  updatedAt: Date;
}

export const buildTrackingComment = (input: TrackingCommentInput): string => {
  const { acceptance, conversation, marker, notification, updatedAt } = input;

  const acceptanceCell = acceptance ? `[${acceptance.id.slice(0, 8)}](${acceptance.url})` : '—';
  const statusCell = acceptance ? (ACCEPTANCE_STATUS[acceptance.status] ?? acceptance.status) : '—';
  const conversationCell = conversation
    ? `[${cell(conversation.title?.trim() || 'Open conversation')} ↗︎](${conversation.url})`
    : '—';
  const notificationCell =
    notification && notification.count > 0
      ? `${notification.count}/${notification.max}${
          notification.reason
            ? ` · ${NOTIFICATION_REASON[notification.reason] ?? notification.reason}`
            : ''
        }`
      : '—';

  return [
    encodeTrackingMarker(marker),
    '',
    `**LobeHub is tracking this pull request.** Merging accepts the delivery; failing checks and review feedback reach the agent that opened it. [Learn more ↗︎](${GITHUB_INTEGRATION_DOCS_URL})`,
    '',
    '| Acceptance | Status | Conversation | Notifications | Updated (UTC) |',
    '| :--- | :--- | :--- | :--- | :--- |',
    `| ${acceptanceCell} | ${statusCell} | ${conversationCell} | ${notificationCell} | ${formatUtc(updatedAt)} |`,
    '',
  ].join('\n');
};

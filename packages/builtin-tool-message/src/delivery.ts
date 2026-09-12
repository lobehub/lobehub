import type {
  MessageDeliveryStatus,
  SendMessageAttachmentOutcome,
  SendMessageDelivery,
  SendMessageState,
  SendMessageTextOutcome,
} from './types';

export type {
  MessageDeliveryStatus,
  SendMessageAttachmentOutcome,
  SendMessageDelivery,
  SendMessageState,
  SendMessageTextOutcome,
} from './types';

export function resolveDeliveryStatus(
  input: Pick<SendMessageDelivery, 'attachments' | 'text'>,
): MessageDeliveryStatus {
  const statuses: Array<SendMessageAttachmentOutcome['status'] | SendMessageTextOutcome['status']> =
    input.attachments.map((item) => item.status);

  if (input.text.status !== 'not_requested') statuses.push(input.text.status);

  if (statuses.length === 0) return 'failed';
  if (statuses.includes('unknown')) return 'unknown';

  const hasAccepted = statuses.some(
    (status) => status === 'accepted' || status === 'link_fallback',
  );
  const hasUnfulfilled = statuses.some(
    (status) => status === 'failed' || status === 'not_attempted',
  );

  if (hasUnfulfilled) return hasAccepted ? 'partial' : 'failed';
  if (statuses.includes('link_fallback')) return 'degraded';
  return 'accepted';
}

export interface MessageSendPresentation {
  content: string;
  status: MessageDeliveryStatus | 'legacy';
  success: boolean;
}

export function getSendMessagePresentation(
  result: SendMessageState,
  target?: { channelId?: string; platform?: string },
): MessageSendPresentation {
  const platform = result.platform ?? target?.platform;
  const channelId = result.channelId ?? target?.channelId;
  const destination = [platform, channelId].filter(Boolean).join(':') || 'target';
  const idSuffix = result.messageId ? ` (messageId: ${result.messageId})` : '';
  const delivery = result.delivery;

  if (!delivery) {
    if (platform === 'wechat') {
      return {
        content:
          `WeChat send outcome is unconfirmed for ${destination}${idSuffix}. ` +
          'The server did not provide per-item send results. ' +
          'Do not assume that the attachments were sent or resend the entire request automatically. ' +
          'Recipient receipt is unconfirmed; use a server version that reports delivery details.',
        status: 'unknown',
        success: false,
      };
    }
    return {
      content: `Message sent to ${destination}${idSuffix}`,
      status: 'legacy',
      success: true,
    };
  }

  const headings: Record<MessageDeliveryStatus, string> = {
    accepted: 'Send accepted by the platform API.',
    degraded:
      'Send degraded: some attachments were submitted as download links, not original media.',
    failed: 'Send not completed: no requested part was confirmed accepted.',
    partial: 'Send partially completed: some requested parts failed or were not attempted.',
    unknown: 'Send outcome uncertain: at least one submission could not be confirmed.',
  };
  // Put the outcome and resend guidance before details that a tool runner may truncate.
  const retryNotice =
    delivery.status === 'accepted'
      ? 'No resend is needed.'
      : 'Do not resend the entire request automatically. Preserve accepted parts and confirm uncertain parts before any targeted resend.';

  return {
    content: [
      headings[delivery.status],
      retryNotice,
      'Recipient receipt is unconfirmed; API acceptance is not proof of receipt.',
      `Target: ${destination}${idSuffix}`,
      JSON.stringify(delivery, null, 2),
    ].join('\n'),
    status: delivery.status,
    success: delivery.status === 'accepted',
  };
}

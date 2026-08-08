import { ConnectorDataError } from '@lobechat/connector-data';
import type { GmailMessage } from '@lobechat/connector-data/gmail';
import { toGmailMessagesXml } from '@lobechat/connector-data/gmail';

import type { UnderstandingProvider } from '../types';

const GMAIL_PROFILE_SEARCHES = [
  { operation: 'recent', query: 'newer_than:90d' },
  { operation: 'receipts', query: 'newer_than:180d receipt' },
  { operation: 'invoices', query: 'newer_than:180d invoice' },
  { operation: 'subscriptions', query: 'newer_than:180d subscription' },
  { operation: 'briefings', query: 'newer_than:180d briefing' },
  { operation: 'reports', query: 'newer_than:180d report' },
  { operation: 'credits', query: 'newer_than:180d credits' },
  { operation: 'ai', query: 'newer_than:180d AI' },
] as const;

const MAX_CONTEXT_MESSAGES = 32;
const MAX_CONTEXT_MESSAGES_PER_SENDER_DOMAIN = 6;

const evidencePriority = ({ labels }: GmailMessage) => {
  const normalized = new Set(labels.map((label) => label.toUpperCase()));
  if (normalized.has('CATEGORY_PROMOTIONS')) return 2;
  if (
    normalized.has('CATEGORY_UPDATES') ||
    normalized.has('CATEGORY_PERSONAL') ||
    normalized.has('IMPORTANT') ||
    normalized.has('INBOX')
  ) {
    return 0;
  }
  return 1;
};

const senderDomain = (message: GmailMessage) => {
  const domain = message.sender?.split('@').at(-1)?.toLowerCase();
  return domain?.includes('.') ? domain : `unknown:${message.id}`;
};

const selectContextMessages = (messages: GmailMessage[]) => {
  const deduplicated = [...new Map(messages.map((message) => [message.id, message])).values()];
  const selected: GmailMessage[] = [];
  const selectedPerDomain = new Map<string, number>();

  for (const priority of [0, 1, 2]) {
    const buckets = new Map<string, GmailMessage[]>();
    for (const message of deduplicated) {
      if (evidencePriority(message) !== priority) continue;
      const domain = senderDomain(message);
      const bucket = buckets.get(domain) ?? [];
      if (bucket.length < MAX_CONTEXT_MESSAGES_PER_SENDER_DOMAIN) bucket.push(message);
      buckets.set(domain, bucket);
    }
    for (let round = 0; selected.length < MAX_CONTEXT_MESSAGES; round += 1) {
      let added = false;
      for (const bucket of buckets.values()) {
        const message = bucket[round];
        if (!message) continue;
        const domain = senderDomain(message);
        const count = selectedPerDomain.get(domain) ?? 0;
        if (count >= MAX_CONTEXT_MESSAGES_PER_SENDER_DOMAIN) continue;
        selected.push(message);
        selectedPerDomain.set(domain, count + 1);
        added = true;
        if (selected.length === MAX_CONTEXT_MESSAGES) break;
      }
      if (!added) break;
    }
    if (selected.length === MAX_CONTEXT_MESSAGES) break;
  }
  return selected;
};

export const GMAIL_PROFILE_QUERIES = GMAIL_PROFILE_SEARCHES.map(({ query }) => query);

export const gmailUnderstandingProvider: UnderstandingProvider = {
  id: 'gmail',
  collect: async ({ connectorData }) => {
    const client = await connectorData.getGmailClient();
    const settled = await Promise.allSettled(
      GMAIL_PROFILE_SEARCHES.map(({ query }) => client.searchMessages({ query })),
    );
    const fulfilled = settled.filter(
      (result): result is PromiseFulfilledResult<GmailMessage[]> => result.status === 'fulfilled',
    );
    const errors = settled.flatMap((result, index) =>
      result.status === 'rejected'
        ? [
            {
              code: 'GMAIL_SEARCH_FAILED',
              message: 'Gmail search category failed',
              operation: GMAIL_PROFILE_SEARCHES[index].operation,
              provider: 'gmail',
              retryable:
                result.reason instanceof ConnectorDataError ? result.reason.retryable : true,
            },
          ]
        : [],
    );
    const selected = selectContextMessages(fulfilled.flatMap(({ value }) => value));
    const diagnostics = {
      errors,
      evidenceCount: selected.length,
      failedCount: errors.length,
      succeededCount: fulfilled.length,
    };
    if (selected.length === 0) {
      if (errors.some(({ retryable }) => retryable)) {
        throw new ConnectorDataError({
          code: 'gmail_evidence_unavailable',
          operation: 'collect',
          provider: 'gmail',
          retryable: true,
        });
      }
      return { context: '', diagnostics, sourceCount: 0 };
    }

    return {
      context: `${[
        'Provider: gmail',
        '# Source Brief',
        '## Gmail Message Signals',
        'Gmail evidence policy:',
        '- CATEGORY_PROMOTIONS is low-weight; use it only for product names, product-discovery behavior, and broad interest areas.',
        '- Prefer CATEGORY_UPDATES, CATEGORY_PERSONAL, IMPORTANT, INBOX, receipts, account notices, direct usage notices, and briefing/calendar emails for durable user understanding.',
        '- Repeated marketing emails should not become identity, role, or work-style claims unless corroborated by stronger non-promotional evidence.',
      ].join('\n\n')}\n\n\`\`\`xml\n${toGmailMessagesXml(selected)}\n\`\`\``,
      diagnostics,
      sourceCount: selected.length,
    };
  },
};

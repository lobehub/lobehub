import type {
  InboundWebhookDeliveryItem,
  InboundWebhookError,
  InboundWebhookItem,
} from '@lobechat/types';
import pc from 'picocolors';

import { formatTimestamp, printTable, timeAgo, timeUntil, truncate } from '../../utils/format';

/** What each `lastError` means, in the words the Web's automation list uses. */
const ERROR_TEXT: Record<InboundWebhookError, string> = {
  access_revoked:
    'Access was revoked; the subscription ended. Delete it and ask the agent to resubscribe.',
  auth: "The connector's authorization has expired. Reconnect the connector.",
  challenge_failed: "The connector could not verify LobeHub's callback address.",
  channel_unavailable:
    'Run results could not be posted to the Channel: the agent or the creator left it, the agent is muted, or the Channel was archived or deleted.',
  connection_refused: 'The connector could not connect to LobeHub to deliver events.',
  delivery_suspended:
    'The connector had paused delivery after repeated failures and was asked to resume. This clears when the next event arrives.',
  event_unavailable: 'The connector no longer offers this event, so the subscription ended.',
  http_4xx: "LobeHub rejected the connector's deliveries.",
  http_5xx: "LobeHub failed while receiving the connector's deliveries.",
  insufficient_budget: 'Not enough credits to run the agent. Later calls run once you top up.',
  server_unreachable: "Could not reach the connector's server.",
  timeout: 'The connector timed out delivering events to LobeHub.',
  tls_error: 'The connector could not open a secure connection to LobeHub.',
  unknown: 'An error was reported without details.',
  wake_cap: 'Calls arrived too often, so some runs in the last 10 minutes were skipped.',
};

export const describeError = (error: InboundWebhookError) =>
  `${ERROR_TEXT[error] ?? 'An error was reported.'} (${error})`;

const DELIVERY_REASON_TEXT: Record<string, string> = {
  agent_start_failed: "The agent couldn't start; it will be retried",
  feature_disabled: 'Webhooks are turned off for this account',
  insufficient_budget: 'Not enough credits to run the agent',
  target_removed: 'The agent was removed',
  topic_busy: 'Waiting for the topic to finish its current run',
  wake_cap: 'Skipped: over 30 runs in 10 minutes',
  webhook_paused: 'Skipped: the webhook was paused',
  webhook_removed: 'The webhook was deleted',
};

const DELIVERY_STATUS_TEXT: Record<InboundWebhookDeliveryItem['status'], string> = {
  failed: 'Failed',
  ignored: 'Skipped',
  pending: 'Waiting',
  processed: 'Ran',
};

export const kindLabel = (item: Pick<InboundWebhookItem, 'kind'>) =>
  item.kind === 'generic' ? 'webhook' : 'mcp event';

export const statusText = (status: InboundWebhookItem['status']) => {
  switch (status) {
    case 'active': {
      return pc.green(status);
    }
    case 'paused': {
      return pc.yellow(status);
    }
    case 'error': {
      return pc.red(status);
    }
    default: {
      return pc.dim(status);
    }
  }
};

/** A generic webhook's name, or an MCP subscription's event and connector. */
export const titleOf = (item: InboundWebhookItem) => {
  if (item.source.kind === 'generic') return item.name || 'Webhook';
  const event = item.name || item.source.eventName;
  return item.connector ? `${item.connector.name} · ${event}` : event;
};

export const agentOf = (item: InboundWebhookItem) =>
  item.agent ? item.agent.title || item.agent.id : '-';

/** Where results go: "Channel X · Thread Y" when posted to a Channel, else the topic mode. */
export const targetOf = (item: InboundWebhookItem) => {
  const delivery = item.source.delivery;
  if (delivery) {
    const channel = item.channel?.title || delivery.channelId;
    const threadId = item.channel?.threadId ?? delivery.threadId;
    if (!threadId) return `Channel ${channel}`;
    return `Channel ${channel} · Thread ${item.channel?.threadTitle || threadId}`;
  }
  if (item.source.kind === 'generic') {
    if (item.source.topicMode === 'new') return 'New topic per call';
    const topic = item.topic?.title || item.source.topicId;
    return topic ? `One shared topic (${topic})` : 'One shared topic';
  }
  return item.topic ? `Topic ${item.topic.title || item.topic.id}` : '-';
};

export const lastCallOf = (item: InboundWebhookItem) =>
  item.lastDeliveryAt ? timeAgo(item.lastDeliveryAt) : 'never';

export function printWebhookTable(items: InboundWebhookItem[]) {
  printTable(
    items.map((item) => [
      item.id,
      kindLabel(item),
      truncate(titleOf(item), 36),
      truncate(agentOf(item), 24),
      statusText(item.status),
      truncate(targetOf(item), 40),
      lastCallOf(item),
    ]),
    ['ID', 'KIND', 'NAME / EVENT', 'AGENT', 'STATUS', 'TARGET', 'LAST CALL'],
  );
}

/** How a system calls a generic webhook; `<key>` stands in for the key, which is never stored here. */
export const curlUsage = (endpoint: string) =>
  [
    `curl -X POST ${endpoint} \\`,
    `  -H "Authorization: Bearer <key>" \\`,
    `  -H 'content-type: application/json' \\`,
    `  -d '{"text":"Build #42 failed on main"}'`,
  ].join('\n');

const USAGE_NOTES = [
  'Any body works (JSON, a form or plain text, up to 256 KB).',
  'Append ?thread=<key> to the URL (or send an X-Thread-Key header) to keep related calls in one topic.',
  'Send an Idempotency-Key header so a retried call runs once.',
];

const line = (label: string, value: string) => console.log(`${pc.dim(label.padEnd(14))}${value}`);

export function printWebhookDetails(item: InboundWebhookItem) {
  console.log(pc.bold(titleOf(item)));
  line('ID', item.id);
  line('Kind', `${kindLabel(item)} (${item.kind})`);
  line('Status', statusText(item.status));
  line('Agent', item.agent ? `${item.agent.title || '-'} (${item.agent.id})` : '-');

  const { source } = item;
  if (source.kind === 'generic') {
    line('Topic mode', source.topicMode === 'new' ? 'New topic per call' : 'One shared topic');
    if (source.topicMode === 'reuse')
      line('Shared topic', item.topic?.title || source.topicId || '(made on the first call)');
    line('Auto-approve', source.autoApprove ? 'on: tools run without waiting for approval' : 'off');
  } else {
    if (item.connector) line('Connector', `${item.connector.name} (${item.connector.identifier})`);
    line('Event', source.eventName);
    if (Object.keys(source.arguments).length > 0)
      line('Arguments', JSON.stringify(source.arguments));
    if (item.topic) line('Topic', `${item.topic.title || '-'} (${item.topic.id})`);
    line('Expires', item.expiresAt ? timeUntil(item.expiresAt) : 'never');
  }
  if (source.delivery) {
    line('Posts to', targetOf(item));
    if (!item.channel) line('', pc.dim('(you cannot see this Channel)'));
  }
  if (item.instructions) line('Instructions', item.instructions);
  line('Last call', item.lastDeliveryAt ? formatTimestamp(item.lastDeliveryAt) : 'never');
  if (item.lastError) line('Last error', pc.red(describeError(item.lastError)));
  line('Created', formatTimestamp(item.createdAt));
  if (!item.canManage) line('Access', pc.dim('view only'));
  else if (source.kind === 'generic' && !item.canConfigure)
    line('Access', pc.dim('pause, resume or delete only: only its creator changes what it runs'));

  if (source.kind === 'generic') {
    console.log();
    if (!item.endpoint) {
      line('URL', pc.dim('(hidden: you cannot see this agent)'));
      return;
    }
    line('URL', item.endpoint);
    console.log();
    console.log(pc.bold('Call it'));
    console.log(curlUsage(item.endpoint));
    for (const note of USAGE_NOTES) console.log(pc.dim(`- ${note}`));
    console.log(
      pc.dim(
        `- The key is shown only when the webhook is created or given a new key. Lost it? Run: lh webhook rotate-key ${item.id}`,
      ),
    );
  }
}

export function printDeliveryTable(items: InboundWebhookDeliveryItem[]) {
  printTable(
    items.map((call) => {
      const result = DELIVERY_STATUS_TEXT[call.status] ?? call.status;
      const reason = call.reason ? DELIVERY_REASON_TEXT[call.reason] || call.reason : '';
      const request = call.payloadPurged ? pc.dim('(content expired)') : call.preview || '';
      return [
        formatTimestamp(call.receivedAt),
        call.test ? `${result} ${pc.dim('(test)')}` : result,
        truncate(reason, 40),
        truncate(call.topic ? call.topic.title || call.topic.id : '-', 28),
        truncate(call.threadKey ? `[${call.threadKey}] ${request}` : request, 60),
      ];
    }),
    ['RECEIVED', 'RESULT', 'REASON', 'TOPIC', 'REQUEST'],
  );
}

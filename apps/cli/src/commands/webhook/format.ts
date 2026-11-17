import type {
  GenericWebhookSource,
  InboundWebhookDeliveryItem,
  InboundWebhookItem,
} from '@lobechat/types';
import pc from 'picocolors';

import { formatTimestamp, printTable, truncate } from '../../utils/format';
import {
  agentOf,
  describeError,
  detailLine as line,
  lastDeliveryOf,
  statusText,
  targetOf,
} from './shared';

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

/** A custom webhook's display name; without one, the identifier the agent knows it by. */
export const titleOf = (item: InboundWebhookItem) => item.name || item.identifier;

export function printWebhookTable(items: InboundWebhookItem[]) {
  printTable(
    items.map((item) => [
      item.id,
      truncate(titleOf(item), 32),
      truncate(item.identifier, 28),
      truncate(agentOf(item), 24),
      statusText(item.status),
      truncate(targetOf(item), 40),
      lastDeliveryOf(item),
    ]),
    ['ID', 'NAME', 'IDENTIFIER', 'AGENT', 'STATUS', 'TARGET', 'LAST CALL'],
  );
}

/** How a system calls a custom webhook; `<key>` stands in for the key, which is never stored here. */
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

/** `source` is the item's own, already narrowed to a custom webhook by `requireGeneric`. */
export function printWebhookDetails(item: InboundWebhookItem, source: GenericWebhookSource) {
  console.log(pc.bold(titleOf(item)));
  line('ID', item.id);
  line('Name', item.name || pc.dim('(none: shows the identifier)'));
  line('Identifier', `${item.identifier} ${pc.dim('(how the agent knows it; fixed)')}`);
  line('Status', statusText(item.status));
  line('Agent', item.agent ? `${item.agent.title || '-'} (${item.agent.id})` : '-');
  line('Topic mode', source.topicMode === 'new' ? 'New topic per call' : 'One shared topic');
  if (source.topicMode === 'reuse')
    line('Shared topic', item.topic?.title || source.topicId || '(made on the first call)');
  line('Auto-approve', source.autoApprove ? 'on: tools run without waiting for approval' : 'off');
  if (source.delivery) {
    line('Posts to', targetOf(item));
    if (!item.channel) line('', pc.dim('(you cannot see this Channel)'));
  }
  if (item.instructions) line('Instructions', item.instructions);
  line('Last call', item.lastDeliveryAt ? formatTimestamp(item.lastDeliveryAt) : 'never');
  if (item.lastError) line('Last error', pc.red(describeError(item.lastError)));
  line('Created', formatTimestamp(item.createdAt));
  if (!item.canManage) line('Access', pc.dim('view only'));
  else if (!item.canConfigure)
    line('Access', pc.dim('pause, resume or delete only: only its creator changes what it runs'));

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

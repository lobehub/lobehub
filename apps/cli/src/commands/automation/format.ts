import type { InboundWebhookItem, McpEventsWebhookSource } from '@lobechat/types';
import pc from 'picocolors';

import { formatTimestamp, printTable, timeUntil, truncate } from '../../utils/format';
import {
  agentOf,
  describeError,
  detailLine as line,
  lastDeliveryOf,
  statusText,
  targetOf,
} from '../webhook/shared';

/** An automation's display name; without one, the event it follows. */
export const titleOf = (item: InboundWebhookItem) => item.name || item.identifier;

export const connectorOf = (item: InboundWebhookItem) =>
  item.connector ? item.connector.name : '-';

const filterOf = (source: McpEventsWebhookSource) =>
  Object.keys(source.arguments).length > 0 ? JSON.stringify(source.arguments) : '';

export function printAutomationTable(items: InboundWebhookItem[]) {
  printTable(
    items.map((item) => [
      item.id,
      truncate(titleOf(item), 32),
      truncate(connectorOf(item), 20),
      truncate(item.identifier, 28),
      truncate(agentOf(item), 24),
      statusText(item.status),
      truncate(targetOf(item), 36),
      lastDeliveryOf(item),
    ]),
    ['ID', 'NAME', 'CONNECTOR', 'EVENT', 'AGENT', 'STATUS', 'RESULTS TO', 'LAST EVENT'],
  );
}

/** `source` is the item's own, already narrowed to a subscription by `requireMcpEvents`. */
export function printAutomationDetails(item: InboundWebhookItem, source: McpEventsWebhookSource) {
  console.log(pc.bold(titleOf(item)));
  line('ID', item.id);
  line('Name', item.name || pc.dim('(none: shows the event)'));
  line('Event', `${item.identifier} ${pc.dim('(how the agent knows it; fixed)')}`);
  line(
    'Connector',
    item.connector ? `${item.connector.name} (${item.connector.identifier})` : pc.dim('(removed)'),
  );
  const filter = filterOf(source);
  line('Filter', filter || pc.dim('(none: every event)'));
  line('Status', statusText(item.status));
  if (item.lastError) line('Last error', pc.red(describeError(item.lastError)));
  line('Agent', item.agent ? `${item.agent.title || '-'} (${item.agent.id})` : '-');
  if (source.delivery) {
    line('Posts to', targetOf(item));
    if (!item.channel) line('', pc.dim('(you cannot see this Channel)'));
    if (item.topic) line('Runs in', `Topic ${item.topic.title || '-'} (${item.topic.id})`);
  } else {
    line('Results in', item.topic ? `Topic ${item.topic.title || '-'} (${item.topic.id})` : '-');
  }
  line('Expires', item.expiresAt ? timeUntil(item.expiresAt) : 'never');
  line('Last event', item.lastDeliveryAt ? formatTimestamp(item.lastDeliveryAt) : 'never');
  line('Created', formatTimestamp(item.createdAt));
  if (!item.canManage) line('Access', pc.dim('view only'));
}

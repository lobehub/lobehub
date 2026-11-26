import type {
  GenericWebhookSource,
  InboundWebhookError,
  InboundWebhookItem,
  McpEventsWebhookSource,
} from '@lobechat/types';
import pc from 'picocolors';

import type { TrpcClient } from '../../api/client';
import { timeAgo } from '../../utils/format';
import { log } from '../../utils/logger';

/**
 * What `lh webhook` and `lh automation` share. Custom webhooks and MCP Events subscriptions live in
 * one table behind one TRPC router, but each group presents only its own kind: an id of the other
 * kind is refused with the command that handles it.
 */

export type JsonOption = { json?: string | boolean };

export const jsonFields = (options: JsonOption) =>
  typeof options.json === 'string' ? options.json : undefined;

function fail(error: unknown): never {
  log.error((error as Error)?.message ?? String(error));
  process.exit(1);
}

/** Run an action, turning a local or TRPC error into a CLI error and exit code 1. */
export const guarded =
  <A extends unknown[]>(fn: (...args: A) => Promise<void>) =>
  async (...args: A) => {
    try {
      await fn(...args);
    } catch (error) {
      fail(error);
    }
  };

const UUID_RE = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

export type InboundWebhookGroup = 'automation' | 'webhook';

const NOUN: Record<InboundWebhookGroup, string> = {
  automation: 'an automation',
  webhook: 'a webhook',
};

/** Ids are uuids; anything else would come back as an unreadable validation error. */
export function assertInboundWebhookId(id: string, group: InboundWebhookGroup) {
  if (!UUID_RE.test(id))
    throw new Error(`"${id}" is not ${NOUN[group]} id. Find the id with: lh ${group} list`);
}

export async function getInboundWebhook(
  client: TrpcClient,
  id: string,
  group: InboundWebhookGroup,
): Promise<InboundWebhookItem> {
  assertInboundWebhookId(id, group);
  return client.inboundWebhook.get.query({ id });
}

/** The `lh automation` command that does what `lh webhook <command>` was asked to. */
const AUTOMATION_COMMAND: Record<string, string> = {
  delete: 'delete',
  edit: 'rename',
  view: 'view',
};

/** The `lh webhook` command that does what `lh automation <command>` was asked to. */
const WEBHOOK_COMMAND: Record<string, string> = {
  check: 'test',
  delete: 'delete',
  rename: 'edit',
  view: 'view',
};

/** A custom webhook's source; an MCP Events subscription is refused with `lh automation`. */
export function requireGeneric(item: InboundWebhookItem, command: string): GenericWebhookSource {
  if (item.source.kind === 'generic') return item.source;
  const instead = AUTOMATION_COMMAND[command] ?? 'view';
  const usage =
    instead === 'rename'
      ? `lh automation rename ${item.id} <name>`
      : `lh automation ${instead} ${item.id}`;
  throw new Error(
    `${item.id} is an automation (MCP Events subscription), not a custom webhook: use lh automation for it, e.g. ${usage}`,
  );
}

/** An MCP Events subscription's source; a custom webhook is refused with `lh webhook`. */
export function requireMcpEvents(
  item: InboundWebhookItem,
  command: string,
): McpEventsWebhookSource {
  if (item.source.kind === 'mcp_events') return item.source;
  const instead = WEBHOOK_COMMAND[command] ?? 'view';
  const usage =
    instead === 'edit'
      ? `lh webhook edit ${item.id} --name <name>`
      : `lh webhook ${instead} ${item.id}`;
  throw new Error(
    `${item.id} is a custom webhook, not an automation (MCP Events subscription): use lh webhook for it, e.g. ${usage}`,
  );
}

/** What each `lastError` means, in the words the Web uses. */
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

export const agentOf = (item: InboundWebhookItem) =>
  item.agent ? item.agent.title || item.agent.id : '-';

/** Where results go: "Channel X · Thread Y" when posted to a Channel, else the Topic. */
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

export const lastDeliveryOf = (item: InboundWebhookItem) =>
  item.lastDeliveryAt ? timeAgo(item.lastDeliveryAt) : 'never';

/** One `Label   value` line of a details view. */
export const detailLine = (label: string, value: string) =>
  console.log(`${pc.dim(label.padEnd(14))}${value}`);

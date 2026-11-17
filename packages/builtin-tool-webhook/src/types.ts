import type {
  GenericWebhookTopicMode,
  InboundWebhookDeliveryItem,
  InboundWebhookError,
  InboundWebhookKind,
} from '@lobechat/types';

export const WebhookIdentifier = 'lobe-webhook';

export const WebhookApiName = {
  checkWebhook: 'checkWebhook',
  createWebhook: 'createWebhook',
  deleteWebhook: 'deleteWebhook',
  listWebhookCalls: 'listWebhookCalls',
  listWebhooks: 'listWebhooks',
  sendTestWebhook: 'sendTestWebhook',
  updateWebhook: 'updateWebhook',
} as const;

/**
 * Where each run's final answer goes. `topic`: it stays in the run's own Topic. `channel`: it is
 * also posted to the main timeline of the Channel this conversation is in. `thread`: to the
 * Thread this conversation is in. Channel destinations exist only in a Channel run, and only for
 * the Channel (or Thread) the run is answering in.
 */
export type WebhookDeliverTo = 'channel' | 'thread' | 'topic';

/** One webhook of the current agent, as the model and the result card see it. Never a key. */
export interface WebhookSummary {
  /** The agent it runs; always the current agent for rows the tool returns. */
  agentId: string | null;
  /** Custom webhooks: the runs it starts approve tools without asking. */
  autoApprove?: boolean;
  /** Whether the current user may change what it runs, test it and issue its key. */
  canConfigure: boolean;
  /** Whether the current user may pause, check or delete it. */
  canManage: boolean;
  createdAt: string;
  /** The Channel (or Thread) each run's answer is posted to; null when it stays in a Topic. */
  deliversTo: {
    channelId: string;
    channelTitle: string | null;
    threadId: string | null;
    threadTitle: string | null;
  } | null;
  /** Custom webhooks: the fixed URL callers POST to (the key travels in a header, never here). */
  endpoint: string | null;
  /** MCP Events subscriptions: the connector event that wakes the agent. */
  event?: {
    arguments: Record<string, unknown>;
    connector: { identifier: string; name: string } | null;
    name: string;
  };
  /** MCP Events subscriptions: when the server's grant ends; null = never. */
  expiresAt: string | null;
  id: string;
  instructions: string | null;
  kind: InboundWebhookKind;
  lastDeliveryAt: string | null;
  lastError: InboundWebhookError | null;
  name: string | null;
  status: 'active' | 'error' | 'paused' | 'terminated';
  /** Custom webhooks: `new` = a new Topic per call, `reuse` = one shared Topic. */
  topicMode?: GenericWebhookTopicMode;
}

// ── listWebhooks (never)
export interface ListWebhooksArgs {
  /** Omit for both custom webhooks and MCP Events subscriptions. */
  kind?: InboundWebhookKind;
}
export interface ListWebhooksState {
  webhooks: WebhookSummary[];
}

// ── createWebhook (required)
export interface CreateWebhookArgs {
  autoApprove?: boolean;
  deliverTo?: WebhookDeliverTo;
  instructions?: string;
  name?: string;
  topicMode?: GenericWebhookTopicMode;
}

/** createWebhook / updateWebhook / checkWebhook */
export interface WebhookState {
  webhook: WebhookSummary;
}

// ── updateWebhook (required)
export interface UpdateWebhookArgs {
  autoApprove?: boolean;
  deliverTo?: WebhookDeliverTo;
  instructions?: string;
  name?: string;
  paused?: boolean;
  topicMode?: GenericWebhookTopicMode;
  webhookId: string;
}

// ── sendTestWebhook (required)
export interface WebhookIdArgs {
  webhookId: string;
}
export interface SendTestWebhookState {
  accepted: boolean;
  /** Why the receiver refused it, when it did. */
  error?: string;
  /** The receiver's HTTP status (202 = accepted, 409 = paused). */
  status: number;
  webhookId: string;
}

// ── listWebhookCalls (never)
export interface WebhookCallsCursor {
  createdAt: string;
  id: string;
}
export interface ListWebhookCallsArgs {
  /** `nextCursor` of the previous page; omit for the newest calls. */
  cursor?: WebhookCallsCursor;
  webhookId: string;
}
export interface ListWebhookCallsState {
  calls: InboundWebhookDeliveryItem[];
  /** Pass back as `cursor` for older calls; absent on the last page. */
  nextCursor?: WebhookCallsCursor;
  webhookId: string;
}

// ── deleteWebhook (required)
export interface DeleteWebhookState {
  deleted: true;
  kind: InboundWebhookKind;
  name: string | null;
  webhookId: string;
}

// ── Failure: the state of any failed call
export type WebhookToolErrorCode =
  | 'bad_request' // the change was refused (invalid settings, Channel membership, …)
  | 'disabled' // webhooks are not enabled for this user
  | 'forbidden' // only the creator (or a workspace admin, to pause/delete) may do this
  | 'not_found' // no such webhook of this agent
  | 'not_in_channel' // a Channel destination outside a Channel run (or a Thread outside a Thread)
  | 'rate_limited' // too many webhooks, or checked too recently
  | 'unsupported_kind' // the action does not apply to this kind of webhook
  | 'unknown';
export interface WebhookToolErrorState {
  error: { code: WebhookToolErrorCode; message: string };
}

export const WEBHOOK_TOOL_ERROR_CODES: readonly WebhookToolErrorCode[] = [
  'bad_request',
  'disabled',
  'forbidden',
  'not_found',
  'not_in_channel',
  'rate_limited',
  'unsupported_kind',
  'unknown',
];

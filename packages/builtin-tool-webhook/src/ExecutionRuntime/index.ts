import type {
  BuiltinServerRuntimeOutput,
  GenericWebhookTopicMode,
  InboundWebhookChannelDelivery,
  InboundWebhookDeliveryPage,
  InboundWebhookItem,
  InboundWebhookKind,
} from '@lobechat/types';

import type {
  CreateWebhookArgs,
  DeleteWebhookState,
  ListWebhookCallsArgs,
  ListWebhookCallsState,
  ListWebhooksState,
  SendTestWebhookState,
  UpdateWebhookArgs,
  WebhookDeliverTo,
  WebhookIdArgs,
  WebhookState,
  WebhookSummary,
  WebhookToolErrorCode,
  WebhookToolErrorState,
} from '../types';
import { WEBHOOK_TOOL_ERROR_CODES } from '../types';

/** What a custom webhook runs, as the management service takes it. */
interface WebhookSettings {
  autoApprove?: boolean;
  instructions?: string | null;
  name?: string | null;
  topicMode?: GenericWebhookTopicMode;
}

/**
 * The server's webhook manager (`InboundWebhookManager`), scoped to the signed-in user. The
 * package has no database or network dependency; the server injects it.
 */
export interface WebhookManageService {
  /** Also returns the key; the runtime drops it before anything reaches the model or the UI. */
  create: (
    input: WebhookSettings & { agentId: string; delivery?: InboundWebhookChannelDelivery },
  ) => Promise<{ item: InboundWebhookItem; secret?: string }>;
  delete: (id: string) => Promise<unknown>;
  get: (id: string) => Promise<InboundWebhookItem>;
  list: (input: { agentId: string; kind: InboundWebhookKind }) => Promise<InboundWebhookItem[]>;
  listDeliveries: (
    id: string,
    cursor?: { createdAt: string; id: string },
  ) => Promise<InboundWebhookDeliveryPage>;
  sendTest: (id: string) => Promise<{ accepted: boolean; error?: string; status: number }>;
  update: (
    id: string,
    input: WebhookSettings & { delivery?: InboundWebhookChannelDelivery | null; paused?: boolean },
  ) => Promise<InboundWebhookItem>;
}

/** Where a Channel run is answering: its Channel, and the Thread when it is in one. */
export interface WebhookChannelOrigin {
  channelId: string;
  threadId: string | null;
}

export interface WebhookRuntimeScope {
  /** The agent running the tool; every call is confined to its webhooks. */
  agentId: string;
  /** Resolves the Channel origin of this run; undefined outside a Channel run. */
  channelOrigin: () => Promise<WebhookChannelOrigin | undefined>;
}

export class WebhookToolError extends Error {
  constructor(
    readonly code: WebhookToolErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'WebhookToolError';
  }
}

/** The server's manager speaks a subset of these codes; anything else reads as `unknown`. */
const ERROR_CODES = new Set<WebhookToolErrorCode>(WEBHOOK_TOOL_ERROR_CODES);

const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

const notFound = () =>
  new WebhookToolError('not_found', 'No custom webhook with this id belongs to this agent.');

/** A custom webhook's row, narrowed so its settings can be read. */
type GenericWebhookItem = InboundWebhookItem & {
  source: Extract<InboundWebhookItem['source'], { kind: 'generic' }>;
};

const isGeneric = (item: InboundWebhookItem): item is GenericWebhookItem =>
  item.source.kind === 'generic';

/** The row as the model and the result card see it: settings and state, never a key. */
export const toWebhookSummary = (item: GenericWebhookItem): WebhookSummary => {
  const delivery = item.source.delivery;
  const deliversTo = item.channel
    ? {
        channelId: item.channel.id,
        channelTitle: item.channel.title,
        threadId: item.channel.threadId,
        threadTitle: item.channel.threadTitle,
      }
    : delivery
      ? {
          channelId: delivery.channelId,
          channelTitle: null,
          threadId: delivery.threadId ?? null,
          threadTitle: null,
        }
      : null;

  return {
    agentId: item.agent?.id ?? null,
    autoApprove: item.source.autoApprove,
    canConfigure: item.canConfigure,
    canManage: item.canManage,
    createdAt: item.createdAt,
    deliversTo,
    endpoint: item.endpoint,
    id: item.id,
    identifier: item.identifier,
    instructions: item.instructions,
    lastDeliveryAt: item.lastDeliveryAt,
    lastError: item.lastError,
    name: item.name,
    status: item.status,
    topicMode: item.source.topicMode,
  };
};

const definedEntries = <T extends Record<string, unknown>>(value: T): Partial<T> =>
  Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as Partial<T>;

/**
 * Manages the current agent's custom webhooks for the agent, end to end. Every id is checked
 * against the agent and the kind first, so a webhook of another agent reads as not found, and an
 * MCP Events subscription (same table, managed by the MCP Events tool) is never touched here.
 * A key never leaves this class.
 */
export class WebhookExecutionRuntime {
  constructor(
    private readonly service: WebhookManageService,
    private readonly scope: WebhookRuntimeScope,
  ) {}

  private async result(read: () => Promise<unknown>): Promise<BuiltinServerRuntimeOutput> {
    try {
      const state = await read();
      return { content: JSON.stringify(state), state, success: true };
    } catch (error) {
      const candidate = error instanceof Error && 'code' in error ? error.code : undefined;
      const code =
        typeof candidate === 'string' && ERROR_CODES.has(candidate as WebhookToolErrorCode)
          ? (candidate as WebhookToolErrorCode)
          : 'unknown';
      const message =
        error instanceof Error && error.message
          ? error.message
          : 'Could not complete the webhook request.';
      const state: WebhookToolErrorState = { error: { code, message } };
      return { content: message, error: { message, type: code }, state, success: false };
    }
  }

  /**
   * A custom webhook of the current agent; anything else, including a malformed id, is not found.
   * An MCP Events subscription of this agent is named as such, so the model turns to its tool.
   */
  private async own(webhookId: string | undefined): Promise<GenericWebhookItem> {
    if (!webhookId || !UUID.test(webhookId)) throw notFound();
    let item: InboundWebhookItem;
    try {
      item = await this.service.get(webhookId);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'not_found') throw notFound();
      throw error;
    }
    if (item.agent?.id !== this.scope.agentId) throw notFound();
    if (!isGeneric(item))
      throw new WebhookToolError(
        'not_found',
        'This id is an MCP Events subscription, not a custom webhook. Manage it with the MCP Events tool (listSubscriptions, renameSubscription, checkSubscription, unsubscribeEvent).',
      );
    return item;
  }

  /**
   * The Channel destination a `deliverTo` names. Only the Channel (and Thread) this run answers
   * in can be named; on create, an omitted `deliverTo` means "where I am answering". Returns
   * `undefined` for no change / no delivery and `null` to stop posting (update only).
   */
  private async resolveDelivery(
    deliverTo: WebhookDeliverTo | undefined,
    mode: 'create' | 'update',
  ): Promise<InboundWebhookChannelDelivery | null | undefined> {
    if (deliverTo === 'topic') return mode === 'update' ? null : undefined;
    if (deliverTo === undefined && mode === 'update') return undefined;

    const origin = await this.scope.channelOrigin();
    if (!origin) {
      if (deliverTo === undefined) return undefined;
      throw new WebhookToolError(
        'not_in_channel',
        "This conversation is not in a Channel, so answers can only stay in a topic. Omit deliverTo or use 'topic'; to post to a Channel, ask from that Channel, or use the `lh webhook` CLI.",
      );
    }
    if (deliverTo === 'channel') return { channelId: origin.channelId };
    if (deliverTo === 'thread' && !origin.threadId)
      throw new WebhookToolError(
        'not_in_channel',
        "This conversation is on the Channel's main timeline, not in a Thread. Use 'channel' or 'topic'.",
      );
    // 'thread', or the create default: where this run is answering.
    return {
      channelId: origin.channelId,
      ...(origin.threadId && { threadId: origin.threadId }),
    };
  }

  /** A Channel destination needs auto-approve: nobody can approve a tool where the answer goes. */
  private resolveAutoApprove(
    autoApprove: boolean | undefined,
    delivery: InboundWebhookChannelDelivery | null | undefined,
  ) {
    if (!delivery) return autoApprove;
    if (autoApprove === false)
      throw new WebhookToolError(
        'bad_request',
        "Posting to a Channel needs autoApprove, because nobody can approve a tool there. Pass deliverTo: 'topic' to keep approvals.",
      );
    return true;
  }

  /** What the manager returns for a custom webhook is one; anything else is a server fault. */
  private summary(item: InboundWebhookItem) {
    if (!isGeneric(item)) throw new Error('The webhook manager returned a non-webhook row.');
    return toWebhookSummary(item);
  }

  listWebhooks = () =>
    this.result(async (): Promise<ListWebhooksState> => {
      const items = await this.service.list({ agentId: this.scope.agentId, kind: 'generic' });
      return {
        webhooks: items
          .filter((item) => item.agent?.id === this.scope.agentId)
          .filter(isGeneric)
          .map(toWebhookSummary),
      };
    });

  createWebhook = (args: CreateWebhookArgs = {}) =>
    this.result(async (): Promise<WebhookState> => {
      const delivery = await this.resolveDelivery(args.deliverTo, 'create');
      const autoApprove = this.resolveAutoApprove(args.autoApprove, delivery);
      // Only the row is kept: the key is shown once, by the user, never in the conversation.
      const { item } = await this.service.create({
        agentId: this.scope.agentId,
        ...definedEntries({
          autoApprove,
          instructions: args.instructions,
          name: args.name,
          topicMode: args.topicMode,
        }),
        ...(delivery && { delivery }),
      });
      return { webhook: this.summary(item) };
    });

  updateWebhook = (args: UpdateWebhookArgs) =>
    this.result(async (): Promise<WebhookState> => {
      const current = await this.own(args.webhookId);
      const delivery = await this.resolveDelivery(args.deliverTo, 'update');
      const autoApprove = this.resolveAutoApprove(args.autoApprove, delivery);
      if (autoApprove === false && delivery === undefined && current.source.delivery)
        throw new WebhookToolError(
          'bad_request',
          "This webhook posts to a Channel, which needs autoApprove. Pass deliverTo: 'topic' together with autoApprove: false.",
        );
      const changes = definedEntries({
        autoApprove,
        delivery,
        instructions: args.instructions,
        name: args.name,
        paused: args.paused,
        topicMode: args.topicMode,
      });
      if (Object.keys(changes).length === 0)
        throw new WebhookToolError('bad_request', 'Nothing to change: pass at least one setting.');
      return { webhook: this.summary(await this.service.update(current.id, changes)) };
    });

  sendTestWebhook = (args: WebhookIdArgs) =>
    this.result(async (): Promise<SendTestWebhookState> => {
      const item = await this.own(args.webhookId);
      const { accepted, error, status } = await this.service.sendTest(item.id);
      return { accepted, ...(error && { error }), status, webhookId: item.id };
    });

  listWebhookCalls = (args: ListWebhookCallsArgs) =>
    this.result(async (): Promise<ListWebhookCallsState> => {
      const item = await this.own(args.webhookId);
      const cursor =
        args.cursor?.createdAt && args.cursor.id
          ? { createdAt: args.cursor.createdAt, id: args.cursor.id }
          : undefined;
      const page = await this.service.listDeliveries(item.id, cursor);
      return {
        calls: page.items,
        ...(page.nextCursor && { nextCursor: page.nextCursor }),
        webhookId: item.id,
      };
    });

  deleteWebhook = (args: WebhookIdArgs) =>
    this.result(async (): Promise<DeleteWebhookState> => {
      const item = await this.own(args.webhookId);
      await this.service.delete(item.id);
      return {
        deleted: true,
        identifier: item.identifier,
        name: item.name,
        webhookId: item.id,
      };
    });
}

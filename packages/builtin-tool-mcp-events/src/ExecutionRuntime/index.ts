import type {
  BuiltinServerRuntimeOutput,
  InboundWebhookItem,
  InboundWebhookKind,
} from '@lobechat/types';

import type {
  ListEventTypesArgs,
  ListEventTypesState,
  ListSubscriptionsArgs,
  ListSubscriptionsState,
  McpEventsToolErrorCode,
  McpEventsToolErrorState,
  McpEventSubscriptionSummary,
  RenameSubscriptionArgs,
  SubscribeEventArgs,
  SubscribeEventState,
  SubscriptionIdArgs,
  SubscriptionState,
  UnsubscribeEventState,
} from '../types';
import { MCP_EVENTS_TOOL_ERROR_CODES } from '../types';

export interface McpEventsScope {
  agentId: string;
  /** The run calling the tool; in a Channel it names the Channel and Thread being answered. */
  operationId?: string;
  topicId: string;
}

/** The runtime's scope: the run's agent and topic, and the signed-in user it acts as. */
export interface McpEventsRuntimeScope extends McpEventsScope {
  userId: string;
}

/**
 * Discovering events and subscribing in this topic. The server implements it; the package has no
 * database or network dependency.
 */
export interface McpEventsExecutionService {
  listEventTypes: (params: ListEventTypesArgs & McpEventsScope) => Promise<ListEventTypesState>;
  listSubscriptions: (params: McpEventsScope) => Promise<ListSubscriptionsState>;
  subscribeEvent: (params: SubscribeEventArgs & McpEventsScope) => Promise<SubscribeEventState>;
}

/**
 * The server's automation manager (`InboundWebhookManager`), scoped to the signed-in user, which
 * owns the rules for listing, renaming, checking and removing a subscription everywhere it can be
 * managed (Settings, the `lh` CLI and this tool).
 */
export interface McpEventsManageService {
  check: (id: string) => Promise<InboundWebhookItem>;
  delete: (id: string) => Promise<unknown>;
  get: (id: string) => Promise<InboundWebhookItem>;
  list: (input: { agentId: string; kind: InboundWebhookKind }) => Promise<InboundWebhookItem[]>;
  update: (id: string, input: { name?: string | null }) => Promise<InboundWebhookItem>;
}

export interface McpEventsRuntimeServices {
  events: McpEventsExecutionService;
  manager: McpEventsManageService;
}

export class McpEventsToolError extends Error {
  constructor(
    readonly code: McpEventsToolErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'McpEventsToolError';
  }
}

const ERROR_CODES = new Set<McpEventsToolErrorCode>(MCP_EVENTS_TOOL_ERROR_CODES);

/** Codes the automation manager speaks under another name. */
const MANAGER_CODES: Record<string, McpEventsToolErrorCode> = { disabled: 'feature_disabled' };

const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

const notFound = () =>
  new McpEventsToolError('not_found', 'No subscription of yours on this agent has this id.');

type SubscriptionItem = InboundWebhookItem & {
  source: Extract<InboundWebhookItem['source'], { kind: 'mcp_events' }>;
};

const isSubscription = (item: InboundWebhookItem): item is SubscriptionItem =>
  item.source.kind === 'mcp_events';

/** A subscription as the manager returns it, in the shape every result of this tool uses. */
export const toSubscriptionSummary = (item: SubscriptionItem): McpEventSubscriptionSummary => ({
  arguments: item.source.arguments,
  connector: { identifier: item.connector?.identifier ?? '', name: item.connector?.name ?? '' },
  ...(item.source.delivery && {
    deliversTo: item.source.delivery.threadId ? ('thread' as const) : ('channel' as const),
  }),
  eventName: item.source.eventName,
  expiresAt: item.expiresAt,
  id: item.id,
  instructions: item.instructions,
  lastError: item.lastError,
  name: item.name,
  // A subscription is never paused; read one that is as needing attention, as the service does.
  status: item.status === 'paused' ? 'error' : item.status,
  topic: item.topic,
});

/**
 * MCP Events for the agent: discover and subscribe in the current topic, and manage this agent's
 * subscriptions that the signed-in user made, in any topic. Every id is checked against the agent
 * and the creator first, so another agent's or another member's subscription reads as not found,
 * and a custom webhook (same table, managed by the Webhooks tool) is never touched here.
 */
export class McpEventsExecutionRuntime {
  private readonly topicScope: McpEventsScope;

  constructor(
    private readonly services: McpEventsRuntimeServices,
    private readonly scope: McpEventsRuntimeScope,
  ) {
    this.topicScope = {
      agentId: scope.agentId,
      ...(scope.operationId && { operationId: scope.operationId }),
      topicId: scope.topicId,
    };
  }

  private async result(read: () => Promise<unknown>): Promise<BuiltinServerRuntimeOutput> {
    try {
      const state = await read();
      return { content: JSON.stringify(state), state, success: true };
    } catch (error) {
      const raw = error instanceof Error && 'code' in error ? error.code : undefined;
      const candidate = typeof raw === 'string' ? (MANAGER_CODES[raw] ?? raw) : undefined;
      const code =
        candidate && ERROR_CODES.has(candidate as McpEventsToolErrorCode)
          ? (candidate as McpEventsToolErrorCode)
          : 'unknown';
      const message =
        error instanceof Error && error.message
          ? error.message
          : 'Could not complete the event subscription request';
      const state: McpEventsToolErrorState = { error: { code, message } };
      return { content: message, error: { type: code, message }, state, success: false };
    }
  }

  /** A subscription of this agent made by this user; anything else is not found. */
  private async own(subscriptionId: string | undefined): Promise<SubscriptionItem> {
    if (!subscriptionId || !UUID.test(subscriptionId)) throw notFound();
    let item: InboundWebhookItem;
    try {
      item = await this.services.manager.get(subscriptionId);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'not_found') throw notFound();
      throw error;
    }
    if (item.agent?.id !== this.scope.agentId || item.creatorId !== this.scope.userId)
      throw notFound();
    if (!isSubscription(item))
      throw new McpEventsToolError(
        'not_found',
        'This id is a custom webhook, not an MCP Events subscription. Manage it with the Webhooks tool.',
      );
    return item;
  }

  /** What the manager returns for a subscription is one; anything else is a server fault. */
  private summary(item: InboundWebhookItem) {
    if (!isSubscription(item))
      throw new Error('The automation manager returned a row that is not a subscription.');
    return toSubscriptionSummary(item);
  }

  listEventTypes = (args: ListEventTypesArgs = {}) =>
    this.result(() =>
      this.services.events.listEventTypes({ connector: args.connector, ...this.topicScope }),
    );

  listSubscriptions = (args: ListSubscriptionsArgs = {}) =>
    this.result(async (): Promise<ListSubscriptionsState> => {
      if (args.scope !== 'agent')
        return this.services.events.listSubscriptions({ ...this.topicScope });
      const items = await this.services.manager.list({
        agentId: this.scope.agentId,
        kind: 'mcp_events',
      });
      return {
        scope: 'agent',
        subscriptions: items
          .filter(
            (item) => item.agent?.id === this.scope.agentId && item.creatorId === this.scope.userId,
          )
          .filter(isSubscription)
          .map(toSubscriptionSummary),
      };
    });

  subscribeEvent = (args: SubscribeEventArgs) =>
    this.result(() =>
      this.services.events.subscribeEvent({
        arguments: args.arguments,
        connector: args.connector,
        ...(args.deliverTo && { deliverTo: args.deliverTo }),
        instructions: args.instructions,
        name: args.name,
        ...(args.title && { title: args.title }),
        ...this.topicScope,
      }),
    );

  /** Only the display name changes; the event it follows, and so what wakes the agent, stays. */
  renameSubscription = (args: RenameSubscriptionArgs) =>
    this.result(async (): Promise<SubscriptionState> => {
      const item = await this.own(args.subscriptionId);
      return {
        subscription: this.summary(
          await this.services.manager.update(item.id, { name: args.name ?? '' }),
        ),
      };
    });

  checkSubscription = (args: SubscriptionIdArgs) =>
    this.result(async (): Promise<SubscriptionState> => {
      const item = await this.own(args.subscriptionId);
      return { subscription: this.summary(await this.services.manager.check(item.id)) };
    });

  unsubscribeEvent = (args: SubscriptionIdArgs) =>
    this.result(async (): Promise<UnsubscribeEventState> => {
      const item = await this.own(args.subscriptionId);
      await this.services.manager.delete(item.id);
      return {
        eventName: item.source.eventName,
        name: item.name,
        removed: true,
        subscriptionId: item.id,
      };
    });
}

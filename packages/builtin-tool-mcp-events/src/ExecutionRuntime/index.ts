import type { BuiltinServerRuntimeOutput } from '@lobechat/types';

import type {
  ListEventTypesArgs,
  ListEventTypesState,
  ListSubscriptionsState,
  McpEventsToolErrorCode,
  McpEventsToolErrorState,
  SubscribeEventArgs,
  SubscribeEventState,
  UnsubscribeEventArgs,
  UnsubscribeEventState,
} from '../types';

export interface McpEventsScope {
  agentId: string;
  topicId: string;
}

/** The server implements this service; the package has no database or network dependency. */
export interface McpEventsExecutionService {
  listEventTypes: (
    params: ListEventTypesArgs & Pick<McpEventsScope, 'agentId'>,
  ) => Promise<ListEventTypesState>;
  listSubscriptions: (params: McpEventsScope) => Promise<ListSubscriptionsState>;
  subscribeEvent: (params: SubscribeEventArgs & McpEventsScope) => Promise<SubscribeEventState>;
  unsubscribeEvent: (
    params: UnsubscribeEventArgs & McpEventsScope,
  ) => Promise<UnsubscribeEventState>;
}

const ERROR_CODES = new Set<McpEventsToolErrorCode>([
  'feature_disabled',
  'public_url_required',
  'connector_not_found',
  'events_unsupported',
  'delivery_unsupported',
  'forbidden',
  'invalid_arguments',
  'callback_unreachable',
  'limit_reached',
  'not_found',
  'unknown',
]);

export class McpEventsExecutionRuntime {
  constructor(
    private readonly service: McpEventsExecutionService,
    private readonly scope: McpEventsScope,
  ) {}

  private async result(read: () => Promise<unknown>): Promise<BuiltinServerRuntimeOutput> {
    try {
      const state = await read();
      return { content: JSON.stringify(state), state, success: true };
    } catch (error) {
      const candidate = error instanceof Error && 'code' in error ? error.code : undefined;
      const code =
        typeof candidate === 'string' && ERROR_CODES.has(candidate as McpEventsToolErrorCode)
          ? (candidate as McpEventsToolErrorCode)
          : 'unknown';
      const message =
        error instanceof Error
          ? error.message
          : 'Could not complete the event subscription request';
      const state: McpEventsToolErrorState = { error: { code, message } };
      return { content: message, error: { type: code, message }, state, success: false };
    }
  }

  listEventTypes = (args: ListEventTypesArgs = {}) =>
    this.result(() =>
      this.service.listEventTypes({ connector: args.connector, agentId: this.scope.agentId }),
    );

  listSubscriptions = () => this.result(() => this.service.listSubscriptions({ ...this.scope }));

  subscribeEvent = (args: SubscribeEventArgs) =>
    this.result(() =>
      this.service.subscribeEvent({
        arguments: args.arguments,
        connector: args.connector,
        instructions: args.instructions,
        name: args.name,
        ...this.scope,
      }),
    );

  unsubscribeEvent = (args: UnsubscribeEventArgs) =>
    this.result(() =>
      this.service.unsubscribeEvent({
        subscriptionId: args.subscriptionId,
        ...this.scope,
      }),
    );
}

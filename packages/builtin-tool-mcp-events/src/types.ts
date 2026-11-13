import type { InboundWebhookError } from '@lobechat/types';

export const McpEventsIdentifier = 'lobe-mcp-events';

export const McpEventsApiName = {
  listEventTypes: 'listEventTypes',
  listSubscriptions: 'listSubscriptions',
  subscribeEvent: 'subscribeEvent',
  unsubscribeEvent: 'unsubscribeEvent',
} as const;

// ── listEventTypes（humanIntervention: never）
export interface ListEventTypesArgs {
  /** 连接器 identifier；省略 = 当前 agent 可用的全部支持 events 的连接器 */
  connector?: string;
}
export interface McpEventTypeItem {
  connector: { identifier: string; name: string };
  description?: string;
  inputSchema?: Record<string, unknown>;
  name: string;
  /** false = 该事件类型不支持 webhook 投递，无法订阅 */
  subscribable: boolean;
}
export interface ListEventTypesState {
  errors?: { connector: string; message: string }[];
  eventTypes: McpEventTypeItem[];
}

// ── subscribeEvent（humanIntervention: always）
export interface SubscribeEventArgs {
  arguments?: Record<string, unknown>;
  /** 连接器 identifier */
  connector: string;
  /** 事件到达时 agent 应该做什么 */
  instructions: string;
  /** 事件类型名 */
  name: string;
}
export interface McpEventSubscriptionSummary {
  arguments: Record<string, unknown>;
  connector: { identifier: string; name: string };
  eventName: string;
  /** null = 永不过期 */
  expiresAt: string | null;
  id: string;
  instructions: string | null;
  lastError: InboundWebhookError | null;
  status: 'active' | 'error' | 'terminated';
}
export interface SubscribeEventState {
  subscription: McpEventSubscriptionSummary;
}

// ── listSubscriptions（never）：当前 topic 的订阅
export interface ListSubscriptionsState {
  subscriptions: McpEventSubscriptionSummary[];
}

// ── unsubscribeEvent（never）
export interface UnsubscribeEventArgs {
  subscriptionId: string;
}
export interface UnsubscribeEventState {
  removed: true;
  subscriptionId: string;
}

// ── 失败：任何 API 失败时，工具结果的 state 为这个形状
export type McpEventsToolErrorCode =
  | 'feature_disabled'
  | 'public_url_required' // APP_URL 不是公网 https
  | 'connector_not_found'
  | 'events_unsupported' // 连接器不支持 events
  | 'delivery_unsupported' // 事件类型不支持 webhook 投递
  | 'forbidden' // 无权限或连接器未认证
  | 'invalid_arguments' // 参数不符合 inputSchema
  | 'callback_unreachable' // server 连不上回调地址
  | 'limit_reached' // 订阅数达到上限
  | 'not_found' // unsubscribe 的目标不存在或不属于当前 topic
  | 'unknown';
export interface McpEventsToolErrorState {
  error: { code: McpEventsToolErrorCode; message: string };
}

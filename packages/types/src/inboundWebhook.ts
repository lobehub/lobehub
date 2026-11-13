import { z } from 'zod';

export const INBOUND_WEBHOOK_KINDS = ['mcp_events'] as const;
export type InboundWebhookKind = (typeof INBOUND_WEBHOOK_KINDS)[number];

export const INBOUND_WEBHOOK_STATUSES = [
  'pending',
  'active',
  'error',
  'terminated',
  'deleting',
] as const;
export type InboundWebhookStatus = (typeof INBOUND_WEBHOOK_STATUSES)[number];

/** `last_error` 的取值。UI 按它映射可读文案，新增取值必须登记到契约。 */
export const INBOUND_WEBHOOK_ERRORS = [
  'auth', // 连接器凭证失效，需要重新连接
  'connection_refused', // 以下六个是 server 报告的、向我们投递失败的类别（SEP 的 lastError）
  'timeout',
  'tls_error',
  'http_4xx',
  'http_5xx',
  'challenge_failed',
  'delivery_suspended', // server 已暂停投递
  'wake_cap', // 触发过于频繁，超过每小时限额
  'insufficient_budget', // 额度不足，无法运行 agent
  'access_revoked', // server 终止订阅：权限被撤销
  'event_unavailable', // server 终止订阅：事件类型被移除或不兼容变更
  'server_unreachable', // 检查 / 续订时连不上 MCP server
  'unknown',
] as const;
export type InboundWebhookError = (typeof INBOUND_WEBHOOK_ERRORS)[number];

/** Errors a newly accepted event proves have recovered; excludes auth and agent execution failures. */
export const INBOUND_WEBHOOK_DELIVERY_ERRORS = [
  'connection_refused',
  'timeout',
  'tls_error',
  'http_4xx',
  'http_5xx',
  'challenge_failed',
  'delivery_suspended',
] as const satisfies readonly InboundWebhookError[];

export interface McpEventsWebhookConfig {
  arguments: Record<string, unknown>;
  eventName: string;
}

export interface McpEventsWebhookState {
  cursor?: string | null;
  deliveryStatus?: {
    active?: boolean;
    failedSince?: string;
    lastDeliveryAt?: string;
    lastError?: string | null;
    retryAfterMs?: number;
    throttled?: boolean;
  };
  refreshBefore?: string | null; // null = 永不过期
  remoteSubscriptionId?: string;
  truncated?: boolean;
}

export type InboundWebhookVerification = { scheme: 'standard_webhooks' };

/** 设置页列表与 `check` 返回的行。不含 secret，不含 state 原文。时间一律是 ISO 字符串。 */
export interface InboundWebhookItem {
  agent: {
    avatar: string | null;
    backgroundColor: string | null;
    id: string;
    title: string | null;
  } | null;
  /** 这个 kind 是否支持手动检查（v1：mcp_events 为 true） */
  canCheck: boolean;
  /** 当前用户能否删除 / 检查这一行 */
  canManage: boolean;
  connector: { avatar: string | null; id: string; identifier: string; name: string } | null;
  createdAt: string;
  creatorId: string;
  /** mcp_events：server 授予的到期时间；null = 永不过期 */
  expiresAt: string | null;
  id: string;
  kind: InboundWebhookKind;
  lastDeliveryAt: string | null;
  lastError: InboundWebhookError | null;
  name: string | null;
  source: { arguments: Record<string, unknown>; eventName: string; kind: 'mcp_events' };
  /** 列表不返回 pending 与 deleting 的行 */
  status: 'active' | 'error' | 'terminated';
  topic: { id: string; title: string | null } | null;
}

/** Validation stays beside domain types so the standalone database layer owns no protocol logic. */
export const McpEventsWebhookConfigSchema = z
  .object({
    arguments: z.record(z.string(), z.unknown()),
    eventName: z.string().min(1),
  })
  .strict();

export const McpEventsWebhookStateSchema = z
  .object({
    cursor: z.string().nullable().optional(),
    deliveryStatus: z
      .object({
        active: z.boolean().optional(),
        failedSince: z.string().optional(),
        lastDeliveryAt: z.string().optional(),
        lastError: z.string().nullable().optional(),
        retryAfterMs: z.number().nonnegative().optional(),
        throttled: z.boolean().optional(),
      })
      .optional(),
    refreshBefore: z.iso.datetime({ offset: true }).nullable().optional(),
    remoteSubscriptionId: z.string().optional(),
    truncated: z.boolean().optional(),
  })
  .strict();

export const InboundWebhookVerificationSchema = z
  .object({
    scheme: z.literal('standard_webhooks'),
  })
  .strict();

export type InboundWebhookConfig = McpEventsWebhookConfig;
export type InboundWebhookState = McpEventsWebhookState;

export const InboundWebhookDataSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('mcp_events'),
    config: McpEventsWebhookConfigSchema,
    state: McpEventsWebhookStateSchema,
    verification: InboundWebhookVerificationSchema,
  }),
]);

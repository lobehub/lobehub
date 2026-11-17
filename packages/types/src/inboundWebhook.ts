import { z } from 'zod';

export const INBOUND_WEBHOOK_KINDS = ['mcp_events', 'generic'] as const;
export type InboundWebhookKind = (typeof INBOUND_WEBHOOK_KINDS)[number];

export const INBOUND_WEBHOOK_STATUSES = [
  'pending',
  'active',
  'error',
  'terminated',
  'deleting',
  'paused', // generic：用户停用；投递被拒绝，不唤醒
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

/** Errors a run that starts proves have recovered: the hourly window reopened, or credits came back. */
export const INBOUND_WEBHOOK_RUN_ERRORS = [
  'wake_cap',
  'insufficient_budget',
] as const satisfies readonly InboundWebhookError[];

export interface McpEventsWebhookConfig {
  arguments: Record<string, unknown>;
  eventName: string;
  /**
   * The connector account (`connector_links.id`) the subscription was made with. The server knows
   * it by that identity, so renewal and unsubscribe must use the same account. Absent for a
   * connector without accounts.
   */
  linkId?: string;
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

/** How a generic webhook picks the Topic each call runs in, unless the caller names a thread. */
export const GENERIC_WEBHOOK_TOPIC_MODES = ['new', 'reuse'] as const;
export type GenericWebhookTopicMode = (typeof GENERIC_WEBHOOK_TOPIC_MODES)[number];

/** Longest caller-supplied thread key (`?thread=` / `X-Thread-Key`). */
export const GENERIC_WEBHOOK_THREAD_KEY_MAX = 200;

export interface GenericWebhookConfig {
  /** Runs this webhook starts approve tools as auto-run; tools marked `always` still wait. */
  autoApprove: boolean;
  /**
   * `reuse` only: an existing Topic of the agent, picked by the creator, that every call without a
   * thread continues. Absent: a Topic of the webhook's own, made on the first call. Kept in the
   * config, not in `topic_id`, whose cascade would delete the webhook with the Topic.
   */
  topicId?: string;
  topicMode: GenericWebhookTopicMode;
}

/** Generic webhooks keep no runtime state. */
export type GenericWebhookState = Record<string, never>;

export type McpEventsWebhookVerification = { scheme: 'standard_webhooks' };
/** The key travels as `Authorization: Bearer <key>`; there is no signature, and no key in the URL. */
export type GenericWebhookVerification = { scheme: 'bearer_token' };
export type InboundWebhookVerification = McpEventsWebhookVerification | GenericWebhookVerification;

export interface McpEventsWebhookSource {
  arguments: Record<string, unknown>;
  eventName: string;
  kind: 'mcp_events';
}
export interface GenericWebhookSource extends GenericWebhookConfig {
  kind: 'generic';
}
export type InboundWebhookSource = McpEventsWebhookSource | GenericWebhookSource;

/**
 * A generic webhook with its key, as `create` and `rotateToken` return it: the only time the key
 * is shown. It is stored encrypted and no other call returns it.
 */
export interface InboundWebhookItemWithSecret {
  item: InboundWebhookItem;
  secret: string;
}

/** 设置页列表与 `check` 返回的行。不含 secret，不含 state 原文。时间一律是 ISO 字符串。 */
export interface InboundWebhookItem {
  agent: {
    avatar: string | null;
    backgroundColor: string | null;
    id: string;
    title: string | null;
  } | null;
  /** 这个 kind 是否支持手动检查（mcp_events 为 true，generic 为 false） */
  canCheck: boolean;
  /**
   * Whether the current user may change what the webhook runs, send a test, get a new URL or see
   * it. Runs execute as the creator, so only the creator, and only while they can see the agent.
   */
  canConfigure: boolean;
  /** 当前用户能否删除 / 检查这一行 */
  canManage: boolean;
  connector: {
    /** Set when the connector is owned by an agent rather than the user (`user_connectors.agent_id`). */
    agentId: string | null;
    avatar: string | null;
    id: string;
    identifier: string;
    name: string;
  } | null;
  createdAt: string;
  creatorId: string;
  /** generic 的调用 URL（不含密钥，固定不变）；看不到 agent 时与其他 kind 一样为 null */
  endpoint: string | null;
  /** mcp_events：server 授予的到期时间；null = 永不过期 */
  expiresAt: string | null;
  id: string;
  instructions: string | null;
  kind: InboundWebhookKind;
  lastDeliveryAt: string | null;
  lastError: InboundWebhookError | null;
  name: string | null;
  source: InboundWebhookSource;
  /** 列表不返回 pending 与 deleting 的行 */
  status: 'active' | 'error' | 'terminated' | 'paused';
  topic: { id: string; title: string | null } | null;
}

/** Validation stays beside domain types so the standalone database layer owns no protocol logic. */
export const McpEventsWebhookConfigSchema = z
  .object({
    arguments: z.record(z.string(), z.unknown()),
    eventName: z.string().min(1),
    linkId: z.string().min(1).optional(),
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

export const McpEventsWebhookVerificationSchema = z
  .object({
    scheme: z.literal('standard_webhooks'),
  })
  .strict();

export const GenericWebhookConfigSchema = z
  .object({
    autoApprove: z.boolean(),
    topicMode: z.enum(GENERIC_WEBHOOK_TOPIC_MODES),
    topicId: z.string().min(1).optional(),
  })
  .strict();

export const GenericWebhookStateSchema = z.object({}).strict();

export const GenericWebhookVerificationSchema = z
  .object({
    scheme: z.literal('bearer_token'),
  })
  .strict();

export type InboundWebhookConfig = McpEventsWebhookConfig | GenericWebhookConfig;
export type InboundWebhookState = McpEventsWebhookState | GenericWebhookState;

/** The kind-specific columns of a row, keyed by kind; the model narrows rows to one of these. */
export interface InboundWebhookDataByKind {
  generic: {
    config: GenericWebhookConfig;
    kind: 'generic';
    state: GenericWebhookState;
    verification: GenericWebhookVerification;
  };
  mcp_events: {
    config: McpEventsWebhookConfig;
    kind: 'mcp_events';
    state: McpEventsWebhookState;
    verification: McpEventsWebhookVerification;
  };
}
export type InboundWebhookData = InboundWebhookDataByKind[InboundWebhookKind];

/** Narrow a row (or view) to one kind, so that kind's config and state can be read. */
export const isInboundWebhookOfKind = <T extends { kind: string }, K extends T['kind']>(
  row: T,
  kind: K,
): row is Extract<T, { kind: K }> => row.kind === kind;

/** Per-kind schemas for the jsonb columns; partial updates are checked against these. */
export const INBOUND_WEBHOOK_KIND_SCHEMAS = {
  generic: {
    config: GenericWebhookConfigSchema,
    state: GenericWebhookStateSchema,
    verification: GenericWebhookVerificationSchema,
  },
  mcp_events: {
    config: McpEventsWebhookConfigSchema,
    state: McpEventsWebhookStateSchema,
    verification: McpEventsWebhookVerificationSchema,
  },
} as const satisfies Record<
  InboundWebhookKind,
  Record<'config' | 'state' | 'verification', z.ZodType>
>;

export const InboundWebhookDataSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('mcp_events'),
    config: McpEventsWebhookConfigSchema,
    state: McpEventsWebhookStateSchema,
    verification: McpEventsWebhookVerificationSchema,
  }),
  z.object({
    kind: z.literal('generic'),
    config: GenericWebhookConfigSchema,
    state: GenericWebhookStateSchema,
    verification: GenericWebhookVerificationSchema,
  }),
]);

/** What happened to one delivery, as the webhook's delivery log shows it. */
export interface InboundWebhookDeliveryItem {
  id: string;
  /** Payload is blanked by signal retention; the row and its outcome remain. */
  payloadPurged: boolean;
  /** Up to 300 characters of the delivered payload; null once purged. */
  preview: string | null;
  /** Why it was skipped, deferred or failed (`wake_cap`, `webhook_paused`, …); null when it woke the Agent. */
  reason: string | null;
  receivedAt: string;
  status: 'pending' | 'processed' | 'ignored' | 'failed';
  /** Sent from the management page rather than by a caller. */
  test: boolean;
  threadKey: string | null;
  topic: { id: string; title: string | null } | null;
}

export interface InboundWebhookDeliveryPage {
  items: InboundWebhookDeliveryItem[];
  /** Keyset position of the next page; absent on the last one. */
  nextCursor?: { createdAt: string; id: string };
}

/** One `inbound_webhooks` row, secret included; checked against the table in the schema package. */
export interface InboundWebhookRow {
  accessedAt: Date;
  agentId: string;
  config: InboundWebhookConfig;
  connectorId: string | null;
  createdAt: Date;
  dedupeKey: string | null;
  id: string;
  instructions: string | null;
  kind: InboundWebhookKind;
  lastDeliveryAt: Date | null;
  lastError: InboundWebhookError | null;
  maintenanceFailures: number;
  name: string | null;
  nextMaintenanceAt: Date | null;
  /** KeyVaults ciphertext; models leave it out of every read shape. */
  secret: string | null;
  state: InboundWebhookState;
  status: InboundWebhookStatus;
  topicId: string | null;
  updatedAt: Date;
  userId: string;
  verification: InboundWebhookVerification;
  wakeCount: number;
  wakeWindowStartedAt: Date;
  workspaceId: string | null;
}

/** What inserting an `inbound_webhooks` row takes; columns with a default are optional. */
export interface InboundWebhookInsert {
  accessedAt?: Date;
  agentId: string;
  config: InboundWebhookConfig;
  connectorId?: string | null;
  createdAt?: Date;
  dedupeKey?: string | null;
  id?: string;
  instructions?: string | null;
  kind: InboundWebhookKind;
  lastDeliveryAt?: Date | null;
  lastError?: InboundWebhookError | null;
  maintenanceFailures?: number;
  name?: string | null;
  nextMaintenanceAt?: Date | null;
  secret?: string | null;
  state?: InboundWebhookState;
  status?: InboundWebhookStatus;
  topicId?: string | null;
  updatedAt?: Date;
  userId: string;
  verification: InboundWebhookVerification;
  wakeCount?: number;
  wakeWindowStartedAt?: Date;
  workspaceId?: string | null;
}

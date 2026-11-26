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
  'channel_unavailable', // 运行结果发不进目标 Channel：Agent 或创建人已不在其中、Agent 被静音、Channel 已归档或删除
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

/**
 * A Channel the run's final answer is posted to, as the Agent's message, instead of staying in a
 * Topic of its own. `threadId` names a Thread of that Channel (`cht_…`); absent, the main timeline.
 * The run itself still works in a Topic; only its answer reaches the Channel.
 */
export interface InboundWebhookChannelDelivery {
  channelId: string;
  threadId?: string;
}

export interface McpEventsWebhookConfig {
  arguments: Record<string, unknown>;
  /** Set when the subscription was made in a Channel: where each event's result is posted. */
  delivery?: InboundWebhookChannelDelivery;
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

/** A generic webhook's fixed identifier: lowercase letters, digits and dashes. */
export const GENERIC_WEBHOOK_IDENTIFIER_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/;
/** What a webhook is known as when its name gives no identifier. */
export const GENERIC_WEBHOOK_DEFAULT_IDENTIFIER = 'webhook';
const GENERIC_WEBHOOK_IDENTIFIER_MAX = 48;

/**
 * The identifier a webhook gets from its name at creation: lowercase ASCII words joined by
 * dashes, at most 48 characters; a name with none (e.g. all CJK) gives `webhook`.
 */
export const genericWebhookIdentifierFromName = (name: string | null | undefined): string => {
  const slug = (name ?? '')
    .normalize('NFKD')
    // Accents come apart into combining marks; drop them so `é` reads as `e`.
    .replaceAll(/\p{M}+/gu, '')
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
    .slice(0, 48)
    .replaceAll(/-+$/g, '');
  return slug || GENERIC_WEBHOOK_DEFAULT_IDENTIFIER;
};

/**
 * `base`, or `base-2`, `base-3`… when the agent already has a webhook known by it, so two of an
 * agent's webhooks (two "CI alerts", or two CJK names that both give `webhook`) never share one.
 */
export const uniqueGenericWebhookIdentifier = (base: string, taken: ReadonlySet<string>) => {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const candidate = `${base.slice(0, GENERIC_WEBHOOK_IDENTIFIER_MAX - suffix.length).replaceAll(/-+$/g, '')}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
};

/**
 * The identifier a webhook is known by. One made before identifiers existed has none stored and
 * goes by `webhook-` and the start of its id, so it stays distinct and never changes either.
 */
export const genericWebhookIdentifierOf = (row: {
  config: { identifier?: string };
  id: string;
}): string =>
  row.config.identifier ?? `${GENERIC_WEBHOOK_DEFAULT_IDENTIFIER}-${row.id.slice(0, 8)}`;

/** Longest caller-supplied thread key (`?thread=` / `X-Thread-Key`). */
export const GENERIC_WEBHOOK_THREAD_KEY_MAX = 200;

export interface GenericWebhookConfig {
  /** Runs this webhook starts approve tools as auto-run; tools marked `always` still wait. */
  autoApprove: boolean;
  /**
   * Post each run's answer to this Channel or Thread. Nobody can approve a tool there, so such
   * runs never wait for approval (`headless`), and setting it requires `autoApprove`.
   * Configured from the CLI and agent tools; the Web shows it read-only.
   */
  delivery?: InboundWebhookChannelDelivery;
  /**
   * How the Agent knows this webhook (`<webhookEvent identifier=…>`), made from the name when it
   * is created and never changed after, so renaming it for people does not change what the
   * Agent's instructions refer to. Unique among the agent's webhooks. Absent on webhooks made
   * before it existed: see `genericWebhookIdentifierOf`.
   */
  identifier?: string;
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
  delivery?: InboundWebhookChannelDelivery;
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
  /**
   * The Channel (and Thread) run results are posted to, for a row with `delivery`. Null when the
   * row has none, or the caller cannot see that Channel (then only `source.delivery` says one is
   * set). Such rows are read-only on the Web; the CLI and agent tools change them.
   */
  channel: {
    id: string;
    /** A project's Channel opens inside its project. */
    projectId: string | null;
    threadId: string | null;
    threadTitle: string | null;
    title: string | null;
  } | null;
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
  /**
   * How the Agent knows it, fixed for the row's life: a custom webhook's identifier, or an MCP
   * Events subscription's event. `name` is for people and can change freely.
   */
  identifier: string;
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

export const InboundWebhookChannelDeliverySchema = z
  .object({
    channelId: z.string().min(1),
    threadId: z.string().min(1).optional(),
  })
  .strict();

/** Validation stays beside domain types so the standalone database layer owns no protocol logic. */
export const McpEventsWebhookConfigSchema = z
  .object({
    arguments: z.record(z.string(), z.unknown()),
    delivery: InboundWebhookChannelDeliverySchema.optional(),
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
    delivery: InboundWebhookChannelDeliverySchema.optional(),
    identifier: z.string().regex(GENERIC_WEBHOOK_IDENTIFIER_PATTERN).optional(),
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

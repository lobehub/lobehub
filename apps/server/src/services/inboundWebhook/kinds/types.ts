import type {
  ExternalOriginMetadata,
  InboundWebhookKind,
  InboundWebhookSource,
  RequestTrigger,
  SignalItem,
  UserInterventionConfig,
} from '@lobechat/types';

import type {
  InboundWebhookModel,
  InboundWebhookView,
  InboundWebhookViewOf,
} from '@/database/models/inboundWebhook';
import type { LobeChatDatabase } from '@/database/type';
import type { resolveForegroundInterventionConfig } from '@/server/services/aiAgent/foregroundIntervention';

export interface InboundWebhookContext<K extends InboundWebhookKind = InboundWebhookKind> {
  db: LobeChatDatabase;
  /** Request-local kind gate snapshot, evaluated for row.userId by a batch/check caller. */
  featureEnabled?: boolean;
  model: InboundWebhookModel;
  row: InboundWebhookViewOf<K>;
}

/** One inbound HTTP request, before any kind has looked at it. */
export interface InboundDeliveryRequest {
  /** Exact request bytes; signatures are verified over these. */
  body: string;
  headers: Headers;
  /** The secret segment of `/inbound/:id/:token`, when the caller used that form. */
  query: URLSearchParams;
  /** Sent by the management page's "Send test", not by a caller. */
  test?: boolean;
}

export interface NormalizedWebhookEvent {
  /** Delivery-routing facts kept in `signals.metadata.address`, e.g. a generic thread key. */
  address?: Record<string, string>;
  control?: 'gap' | 'terminated';
  cursor?: string | null;
  data: Record<string, unknown>;
  /** Stable per delivery: redeliveries with the same id are acknowledged without a second signal. */
  eventId: string;
  /** Extra non-content facts kept in `signals.metadata.extra`. */
  extra?: Record<string, unknown>;
  name: string;
  timestamp: string;
}

export type InboundDeliveryStatus = 200 | 202 | 400 | 401 | 409 | 410 | 413 | 415 | 429 | 503;

export interface DeliveryResult {
  event?: NormalizedWebhookEvent;
  response?: Record<string, unknown>;
  /** A status other than 200 answers the request without storing anything. */
  status?: Exclude<InboundDeliveryStatus, 202>;
}

export type SettleStatus = 'pending' | 'processed' | 'ignored' | 'failed';

/** What one wake hands a kind: the claimed batch and the means to settle it early. */
export interface InboundWebhookWakeContext<
  K extends InboundWebhookKind = InboundWebhookKind,
> extends InboundWebhookContext<K> {
  batch: SignalItem[];
  intervention: typeof resolveForegroundInterventionConfig;
  ownsClaim: () => Promise<boolean>;
  /** Settle the whole batch, or just `signals` of it. */
  settle: (status: SettleStatus, reason: string, signals?: SignalItem[]) => Promise<void>;
}

/** The run a wake starts; every field is passed to `execAgent` as is. */
export interface InboundWebhookRun {
  externalOrigin: ExternalOriginMetadata;
  prompt: string;
  /** Title of a Topic the run creates. */
  title?: string;
  /** Absent: `execAgent` starts a new Topic. */
  topicId?: string;
  userInterventionConfig: UserInterventionConfig;
  /** Recorded on a Topic the run creates, so later deliveries of the thread find it. */
  webhookThread?: { threadKey: string; webhookId: string };
}

/** Either the kind already settled the batch (`outcome`), or it asks for a run. */
export type InboundWebhookWakePlan = { outcome: string } | { run: InboundWebhookRun };

/** One kind of inbound webhook; `K` narrows every row it is handed to that kind. */
export interface InboundWebhookKindHandler<K extends InboundWebhookKind = InboundWebhookKind> {
  /** Answer for an accepted delivery; absent: `200 {}`. */
  acknowledge?: (
    signal: { id: string },
    duplicate: boolean,
  ) => { body: Record<string, unknown>; status: 200 | 202 };
  readonly canCheck: boolean;
  /** When the row stops being valid on its own (an MCP subscription's expiry); absent: never. */
  expiresAt?: (row: InboundWebhookViewOf<K>) => string | null;
  /** The group a signal runs in (a thread, or the calls without one); set with `groupSignals`. */
  groupKey?: (row: InboundWebhookViewOf<K>, signal: SignalItem) => string;
  /**
   * From the signals a wake could claim, the ones this wake claims, skipping the groups in
   * `exclude` (ones this wake already could not run); absent: all of them.
   */
  groupSignals?: (
    row: InboundWebhookViewOf<K>,
    signals: SignalItem[],
    exclude: ReadonlySet<string>,
  ) => SignalItem[];
  isEnabled: (userId: string) => Promise<boolean>;
  maintain?: (ctx: InboundWebhookContext<K>) => Promise<void>;
  /** After a new delivery is stored, before it is acknowledged (e.g. advance a stream cursor). */
  onPersisted?: (ctx: InboundWebhookContext<K>, event: NormalizedWebhookEvent) => Promise<void>;
  parseDelivery: (
    ctx: InboundWebhookContext<K>,
    request: InboundDeliveryRequest,
  ) => Promise<DeliveryResult>;
  planWake: (ctx: InboundWebhookWakeContext<K>) => Promise<InboundWebhookWakePlan>;
  /** `signals.source` of this kind's deliveries. */
  readonly signalSource: string;
  source: (row: InboundWebhookViewOf<K>) => InboundWebhookSource;
  /** Whether the row's wake target still exists; false removes the webhook. */
  targetExists: (ctx: InboundWebhookContext<K>) => Promise<boolean>;
  teardown?: (ctx: InboundWebhookContext<K>) => Promise<void>;
  readonly trigger: RequestTrigger;
  verify: (params: {
    request: InboundDeliveryRequest;
    row: InboundWebhookViewOf<K>;
    secret: string | null;
  }) => boolean;
}

export type { InboundWebhookView };

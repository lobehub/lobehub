import type { AgentShareToolGrant } from './agent/share';

/** Request-scoped pricing inputs resolved before model execution. */
export interface ModelPricingContext {
  plan: string;
  scope: 'personal';
}

/** Request-scoped data available to dynamic model router resolution. */
export interface RouterRuntimeRequestContext {
  model?: string;
  pricingContext?: ModelPricingContext;
}

export enum RequestTrigger {
  AgentShare = 'agent_share',
  AgentSignal = 'agent_signal',
  Api = 'api',
  Bot = 'bot',
  Chat = 'chat',
  Cli = 'cli',
  Cron = 'cron',
  Eval = 'eval',
  FileEmbedding = 'file_embedding',
  Image = 'image',
  Memory = 'memory',
  MultimodalAnalysis = 'multimodal_analysis',
  Notify = 'notify',
  Onboarding = 'onboarding',
  Openapi = 'openapi',
  /** A run the user deferred to a future time (`topic.metadata.scheduledRun`). */
  Scheduled = 'scheduled',
  SemanticSearch = 'semantic_search',
  SignupEmailLLMReview = 'signup_email_llm_review',
  Topic = 'topic',
  Video = 'video',
}

/**
 * Everything one shared-agent visitor run carries: WHO the run belongs to
 * (`agentId` / `shareId` / `visitorUserId`), WHAT the visitor is allowed to
 * reach (`allowReadMemory` / `toolGrants` / `knowledgeBaseIds`), and HOW
 * much of the run is shown back to them (`showErrorDetails` / `showModelInfo`).
 *
 * Single source of truth for the runtime-side share marker: it is stamped once
 * at operation creation onto `state.metadata.agentShareVisitor` and read back
 * by every later step, so no step has to re-read the share row.
 *
 * SECURITY: never derived from request headers or any other client input — its
 * fields decide both permission and billing, so a client could otherwise forge
 * another user's run. It is always built server-side from the already-resolved
 * share gate.
 *
 * Never hand this object to a billing point as a whole — the permission fields
 * have no place in spend metadata. Project it with
 * {@link toAgentShareVisitorIds} instead.
 */
export interface AgentShareVisitorContext {
  /** The shared agent (`agents.id`) this run executes. */
  agentId: string;
  /**
   * Mirrors `shareConfig.allowReadMemory` so the memory tool's dispatch-time
   * gate (`isShareBlockedDataToolCall`) can be re-applied at
   * `BuiltinToolsExecutor.execute`, the actual unbypassable chokepoint.
   */
  allowReadMemory?: boolean;
  /**
   * The agent's OWN persisted knowledge-base assignment, never derived from
   * visitor input, so `isShareBlockedDataToolCall` can id-scope
   * `viewKnowledgeBase`'s `id` argument. Always empty today (a share grants no
   * knowledge-base access).
   */
  knowledgeBaseIds?: string[];
  /**
   * The `agentShares.id` this run was authorized against — the revocation
   * token re-checked at every step boundary (see
   * `AgentShareModel.isRunStillAuthorized`).
   */
  shareId: string;
  /** `AgentShareConfig.showErrorDetails` — gates visitor-facing error redaction. */
  showErrorDetails?: boolean;
  /** `AgentShareConfig.showModelInfo` — gates visitor-facing model/provider/usage redaction. */
  showModelInfo?: boolean;
  /**
   * Mirrors `shareConfig.toolGrants` so tool runtimes that resolve their
   * target outside `toolManifestMap` (e.g. `activateSkill`,
   * `lobe-topic-reference`) can apply the same allowlist the assembled tool set
   * already enforces.
   */
  toolGrants?: AgentShareToolGrant[];
  /** The visitor's user id, under which the run's spend is attributed. */
  visitorUserId: string;
}

/**
 * The billing-safe projection of {@link AgentShareVisitorContext}: only the ids
 * needed to attribute a charge, with every permission / redaction field
 * dropped. This is the ONLY shape allowed to reach spend metadata.
 */
export type AgentShareVisitorIds = Pick<
  AgentShareVisitorContext,
  'agentId' | 'shareId' | 'visitorUserId'
>;

/**
 * Project a runtime share marker down to its billing-safe ids. The single
 * allowed way to move an {@link AgentShareVisitorContext} into a
 * {@link SpendOrigin} — never spread the context itself, which also carries
 * permissions that have no place in billing metadata.
 */
export const toAgentShareVisitorIds = (ctx: AgentShareVisitorContext): AgentShareVisitorIds => ({
  agentId: ctx.agentId,
  shareId: ctx.shareId,
  visitorUserId: ctx.visitorUserId,
});

/**
 * Origin attribution carried alongside a request so a billing point that runs
 * outside the originating request (async task, webhook, settle-time charge) can
 * stamp the same origin the synchronous LLM path stamps.
 *
 * Always a plain projection: only the ids needed for attribution travel here,
 * never the originating runtime object, which also carries permissions that
 * have no place in billing metadata.
 */
export interface SpendOrigin {
  /**
   * Present only for a shared-agent visitor run. The JSON key `agentShare` is
   * persisted into spend-log / budget-reservation metadata and queried by
   * `SpendLogModel` — do NOT rename it.
   */
  agentShare?: AgentShareVisitorIds;
  /** Request source, see {@link RequestTrigger}. */
  trigger?: string;
}

// ******* Runtime Biz Error ******* //
export const AgentRuntimeErrorType = {
  AgentRuntimeError: 'AgentRuntimeError', // Agent Runtime module runtime error
  /**
   * The `parent_id` referenced by an assistant / tool message no longer exists
   * in the database — usually because the user deleted the topic / parent
   * message during operation execution. The conversation chain is broken, so
   * the runtime stops fail-fast instead of letting the next step hit another
   * FK violation. Attributed to `user` (expected on topic deletion), not a
   * harness failure.
   */
  ConversationParentMissing: 'ConversationParentMissing',
  /**
   * The tools array (count or serialized size) exceeds the provider/model
   * limit configured in the model registry (maxToolCount / maxToolPayloadBytes).
   * The harness caught this before dispatching to upstream, so no API call was
   * wasted. The error payload carries diagnostic fields (provider, model,
   * toolCount, maxToolCount, etc.) that the UI can use to surface actionable
   * advice (reduce MCP servers / switch model).
   */
  ExceededToolLimit: 'ExceededToolLimit',
  LocationNotSupportError: 'LocationNotSupportError',
  /**
   * No model provider is configured / enabled for the requested model. Surfaces
   * from `RouterRuntime.resolveRouters` when the router list resolves empty —
   * typically because the user has not added an API key or enabled a provider.
   */
  NoAvailableProvider: 'NoAvailableProvider',

  AccountDeactivated: 'AccountDeactivated',
  /**
   * Short-window rate limit (RPM / TPM / concurrency) hit on the provider side.
   * Transient and retryable — distinct from `InsufficientQuota` which means
   * the account-level balance is exhausted.
   */
  RateLimitExceeded: 'RateLimitExceeded',
  /**
   * @deprecated Use `RateLimitExceeded` instead. The legacy name conflated
   * short-window rate limits with long-term quota exhaustion. Kept as an
   * alias so older callers and stored data continue to resolve via
   * `getErrorCodeSpec` / `isUserSideError`.
   */
  QuotaLimitReached: 'QuotaLimitReached',
  InsufficientQuota: 'InsufficientQuota',

  ModelNotFound: 'ModelNotFound',

  PermissionDenied: 'PermissionDenied',
  ExceededContextWindow: 'ExceededContextWindow',

  InvalidProviderAPIKey: 'InvalidProviderAPIKey',
  ProviderBizError: 'ProviderBizError',

  // —— Added by unified error scheme (additive, all attribution-tagged in spec table) ——
  /** Provider returned 503 / overloaded / "high demand" — transient, retryable. */
  ProviderServiceUnavailable: 'ProviderServiceUnavailable',
  /** Network timeout / connection drop talking to the provider. */
  ProviderNetworkError: 'ProviderNetworkError',
  /** Proxy/router has no channel for the requested model (key pool exhausted, no upstream). */
  NoAvailableChannel: 'NoAvailableChannel',
  /** Upstream content-moderation / safety filter rejected the input or output. */
  ContentModeration: 'ContentModeration',
  /** Model lacks the requested capability (VLM / tool calling / prefill). */
  CapabilityNotSupported: 'CapabilityNotSupported',
  /** Provider rejected the request as malformed (bad JSON, schema validation, etc.). */
  InvalidRequestFormat: 'InvalidRequestFormat',
  /**
   * Upstream proxy / gateway layer failed (openresty, litellm, HTML 5xx,
   * Cloudflare 525) — distinct from the provider's own service. Split out of
   * the `ProviderBizError` catch-all.
   */
  UpstreamGatewayError: 'UpstreamGatewayError',
  /**
   * Provider returned a malformed / unparseable payload (Go re-marshal failure,
   * bad tool-call JSON, upstream Python TypeError). Not retryable. Split out of
   * `ProviderBizError`.
   */
  UpstreamMalformedResponse: 'UpstreamMalformedResponse',
  /**
   * Bare upstream HTTP error with no further context (e.g. "400 status code").
   * The residual provider bucket once the richer codes have had their pass.
   */
  UpstreamHttpError: 'UpstreamHttpError',
  /** User-side misconfiguration (wrong base URL, missing env var, virtual-key allowlist, etc.). */
  UserConfigError: 'UserConfigError',
  /** Gateway watchdog killed an idle agent operation — harness-side. */
  OperationInactivityTimeout: 'OperationInactivityTimeout',

  InvalidOllamaArgs: 'InvalidOllamaArgs',
  OllamaBizError: 'OllamaBizError',
  OllamaServiceUnavailable: 'OllamaServiceUnavailable',

  InvalidBedrockCredentials: 'InvalidBedrockCredentials',
  InvalidVertexCredentials: 'InvalidVertexCredentials',
  StreamChunkError: 'StreamChunkError',
  /**
   * The model returned an empty completion — no text content, no tool calls,
   * and ~0 output tokens — typically after a stalled tool loop where it
   * effectively gives up. Retryable: re-issuing the same request usually
   * yields a real response. Without this code the harness silently finalized
   * to `done` and persisted a blank assistant message (empty bubble). See
   * This addresses the "empty completion" failure mode: after a stalled
   * tool loop the model may give up and emit a blank turn with ~0 output
   * tokens, no text, and no tool calls.
   */
  ModelEmptyCompletion: 'ModelEmptyCompletion',
  /**
   * The model explicitly refused an otherwise empty completion. This stays
   * separate from ModelEmptyCompletion so users receive an actionable refusal
   * message and operations can distinguish intentional provider behavior from
   * unexplained blank responses.
   */
  ModelRefusal: 'ModelRefusal',
  /**
   * A persistence-layer query / transaction failed (Drizzle "Failed query:
   * …"). Harness-side: the DB write/read or txn could not complete and
   * surfaced as an unhandled error instead of being retried / degraded.
   */
  DatabasePersistError: 'DatabasePersistError',
  /**
   * The Redis / Upstash state store dropped a command mid-flight (ioredis
   * "Command aborted due to connection close", request-size limit, suspended
   * DB, …). Harness-side infra — the agent state layer, not the LLM provider.
   */
  StateStorePersistError: 'StateStorePersistError',
  /**
   * A state-store (Redis / Upstash) READ failed: either a blocking read
   * (XREAD / BLPOP, consuming the agent event stream or waiting on a tool
   * result) was aborted because the caller disconnected ("ERR caller gone"), or
   * the operation's agent state could not be loaded ("Agent state not found for
   * operation …"). System-side read failure, kept distinct from the write-side
   * StateStorePersistError; counts as a failure.
   */
  StateStoreReadError: 'StateStoreReadError',
  /**
   * A context-engine pipeline processor threw while building the prompt
   * context ("Processor [<name>] execution failed"). Harness-side bug in the
   * context assembly stage — the `PipelineError` thrown by
   * `packages/context-engine` (its `error.name` is `PipelineError`, aliased
   * to this code in the spec table).
   */
  ContextEnginePipelineError: 'ContextEnginePipelineError',
  /**
   * A `JSON.parse` inside the harness threw on data the harness itself
   * produced, stored or round-tripped — V8 reports it as `SyntaxError: … in
   * JSON at position N` / `Unexpected end of JSON input`. Always our bug: the
   * value should have been valid JSON by construction, so a failure means some
   * serialization step corrupted or truncated it. Kept out of the
   * `AgentRuntimeError` catch-all so this class stays countable on its own
   * instead of hiding inside the generic fallback bucket.
   */
  HarnessJsonParseError: 'HarnessJsonParseError',

  InvalidGithubToken: 'InvalidGithubToken',
  InvalidGithubCopilotToken: 'InvalidGithubCopilotToken',

  ConnectionCheckFailed: 'ConnectionCheckFailed',

  // ******* Image Generation Error ******* //
  ProviderContentPolicyViolation: 'ProviderContentPolicyViolation',
  ProviderNoImageGenerated: 'ProviderNoImageGenerated',

  InvalidComfyUIArgs: 'InvalidComfyUIArgs',
  ComfyUIBizError: 'ComfyUIBizError',
  ComfyUIServiceUnavailable: 'ComfyUIServiceUnavailable',
  ComfyUIEmptyResult: 'ComfyUIEmptyResult',
  ComfyUIUploadFailed: 'ComfyUIUploadFailed',
  ComfyUIWorkflowError: 'ComfyUIWorkflowError',
  ComfyUIModelError: 'ComfyUIModelError',

  /**
   * @deprecated
   */
  NoOpenAIAPIKey: 'NoOpenAIAPIKey',
} as const;
export type ILobeAgentRuntimeErrorType =
  (typeof AgentRuntimeErrorType)[keyof typeof AgentRuntimeErrorType];

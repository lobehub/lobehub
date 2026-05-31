export enum RequestTrigger {
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
  Notify = 'notify',
  Onboarding = 'onboarding',
  Openapi = 'openapi',
  SemanticSearch = 'semantic_search',
  SignupEmailLLMReview = 'signup_email_llm_review',
  Topic = 'topic',
  Video = 'video',
  VisualAnalysis = 'visual_analysis',
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
   * LOBE-9834.
   */
  ModelEmptyCompletion: 'ModelEmptyCompletion',
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
   * A context-engine pipeline processor threw while building the prompt
   * context ("Processor [<name>] execution failed"). Harness-side bug in the
   * context assembly stage — the `PipelineError` thrown by
   * `packages/context-engine` (its `error.name` is `PipelineError`, aliased
   * to this code in the spec table).
   */
  ContextEnginePipelineError: 'ContextEnginePipelineError',

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

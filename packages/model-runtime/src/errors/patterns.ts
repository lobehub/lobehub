import type { ILobeAgentRuntimeErrorType } from '@lobechat/types';
import { AgentRuntimeErrorType } from '@lobechat/types';

/**
 * One entry in the pattern registry.
 *
 * Patterns are matched against the upstream error message via either substring
 * inclusion or regex test. Substring matching is the default and preferred form
 * because it's cheap, debuggable, and resilient to whitespace.
 *
 * A pattern can be scoped to a specific `provider` or upstream `errorType` when
 * the same substring could otherwise produce false positives across providers.
 */
export interface ErrorPattern {
  /** Code produced when this pattern matches. */
  code: ILobeAgentRuntimeErrorType;

  /** Optional upstream errorType scope. When set, only matches errors carrying that errorType. */
  errorType?: string;

  /** Match rule. */
  match:
    | { kind: 'substring'; value: string; caseInsensitive?: boolean }
    | { kind: 'regex'; value: RegExp };

  /** Short note on origin / why the pattern is here. */
  note?: string;

  /** Optional provider scope (single key or list). When set, only matches errors from that provider. */
  provider?: string | string[];
}

const sub = (value: string, opts?: { caseInsensitive?: boolean }): ErrorPattern['match'] => ({
  kind: 'substring',
  value,
  caseInsensitive: opts?.caseInsensitive,
});

/**
 * Source of truth for upstream-message-driven error classification.
 *
 * Layout: one section per `AgentRuntimeErrorType`. Within a section, patterns
 * are roughly grouped by provider. Adding a new pattern is a one-line addition.
 *
 * Provenance: most entries are harvested from the agent-gateway production
 * dashboard plus the previous `isXxxError.ts` utilities under
 * `packages/model-runtime/src/utils/`.
 */
export const ERROR_PATTERNS: ErrorPattern[] = [
  // ─────────────────────────────────────────────────────────────────────────
  // DatabasePersistError — MUST stay first. Drizzle stringifies failed queries
  // as `Failed query: <sql> params: <values>`, embedding arbitrary parameter
  // text (model names, user messages, error_log rows) that otherwise trips
  // unrelated provider patterns below. First-match-wins, so claim it up front.
  // ─────────────────────────────────────────────────────────────────────────
  {
    code: AgentRuntimeErrorType.DatabasePersistError,
    match: sub('Failed query:'),
    note: 'Drizzle wrapper around a failed Postgres query / transaction.',
  },

  // ─────────────────────────────────────────────────────────────────────────
  // ExceededContextWindow
  // ─────────────────────────────────────────────────────────────────────────
  {
    code: AgentRuntimeErrorType.ExceededContextWindow,
    match: sub('maximum context length', { caseInsensitive: true }),
  },
  {
    code: AgentRuntimeErrorType.ExceededContextWindow,
    match: sub('context length exceeded', { caseInsensitive: true }),
  },
  { code: AgentRuntimeErrorType.ExceededContextWindow, match: sub('context_length_exceeded') },
  {
    code: AgentRuntimeErrorType.ExceededContextWindow,
    match: sub('context window exceeds', { caseInsensitive: true }),
  },
  {
    code: AgentRuntimeErrorType.ExceededContextWindow,
    match: sub('exceeds the context window', { caseInsensitive: true }),
  },
  {
    code: AgentRuntimeErrorType.ExceededContextWindow,
    match: sub('prompt is too long', { caseInsensitive: true }),
  },
  {
    code: AgentRuntimeErrorType.ExceededContextWindow,
    match: sub('input is too long', { caseInsensitive: true }),
  },
  {
    code: AgentRuntimeErrorType.ExceededContextWindow,
    match: sub('input tokens exceed the configured limit', { caseInsensitive: true }),
  },
  {
    code: AgentRuntimeErrorType.ExceededContextWindow,
    match: sub('too many input tokens', { caseInsensitive: true }),
  },
  {
    code: AgentRuntimeErrorType.ExceededContextWindow,
    match: sub('exceeds the maximum number of tokens', { caseInsensitive: true }),
  },
  {
    code: AgentRuntimeErrorType.ExceededContextWindow,
    match: sub('maximum allowed number of input tokens', { caseInsensitive: true }),
  },
  {
    code: AgentRuntimeErrorType.ExceededContextWindow,
    match: sub('request too large for model', { caseInsensitive: true }),
  },
  { code: AgentRuntimeErrorType.ExceededContextWindow, match: sub('exceeded max context length') },
  {
    code: AgentRuntimeErrorType.ExceededContextWindow,
    match: sub('Range of input length should be'),
  },
  {
    code: AgentRuntimeErrorType.ExceededContextWindow,
    match: sub('CONTENT_LENGTH_EXCEEDS_THRESHOLD'),
    note: 'kiro/claude-* via openai-compat proxy',
  },
  {
    code: AgentRuntimeErrorType.ExceededContextWindow,
    match: sub('content exceeds maximum length of 100KB'),
  },
  { code: AgentRuntimeErrorType.ExceededContextWindow, match: sub('免费API限制模型输入token小于') },

  // ─────────────────────────────────────────────────────────────────────────
  // InsufficientQuota — account balance / billing exhausted (long-term)
  // ─────────────────────────────────────────────────────────────────────────
  {
    code: AgentRuntimeErrorType.InsufficientQuota,
    match: sub('insufficient balance', { caseInsensitive: true }),
  },
  {
    code: AgentRuntimeErrorType.InsufficientQuota,
    match: sub('insufficient quota', { caseInsensitive: true }),
  },
  {
    code: AgentRuntimeErrorType.InsufficientQuota,
    match: sub('account is suspended due to insufficient balance', { caseInsensitive: true }),
  },
  {
    code: AgentRuntimeErrorType.InsufficientQuota,
    match: sub('balance is not enough', { caseInsensitive: true }),
  },
  {
    code: AgentRuntimeErrorType.InsufficientQuota,
    match: sub('billing hard limit has been reached', { caseInsensitive: true }),
  },
  {
    code: AgentRuntimeErrorType.InsufficientQuota,
    match: sub('exceeded your current quota', { caseInsensitive: true }),
  },
  {
    code: AgentRuntimeErrorType.InsufficientQuota,
    match: sub('account overdue', { caseInsensitive: true }),
  },
  { code: AgentRuntimeErrorType.InsufficientQuota, match: sub('please check your unpaid order') },
  { code: AgentRuntimeErrorType.InsufficientQuota, match: sub('Insufficient credits') },
  {
    code: AgentRuntimeErrorType.InsufficientQuota,
    match: sub('This request requires more credits'),
  },
  {
    code: AgentRuntimeErrorType.InsufficientQuota,
    match: sub('The free tier of the model has been exhausted'),
  },
  {
    code: AgentRuntimeErrorType.InsufficientQuota,
    match: sub('Free credits temporarily have restricted access'),
  },
  {
    code: AgentRuntimeErrorType.InsufficientQuota,
    match: sub('The free period of this model ended'),
  },
  { code: AgentRuntimeErrorType.InsufficientQuota, match: sub('user quota is not enough') },
  {
    code: AgentRuntimeErrorType.InsufficientQuota,
    match: sub('a subscription is required for access'),
  },
  {
    code: AgentRuntimeErrorType.InsufficientQuota,
    match: sub('this model requires a subscription'),
    note: 'Ollama cloud paid-only model',
  },
  {
    code: AgentRuntimeErrorType.InsufficientQuota,
    match: sub('does not have a valid coding plan subscription'),
  },
  {
    code: AgentRuntimeErrorType.InsufficientQuota,
    match: sub('Third-party apps now draw from your extra usage'),
  },
  { code: AgentRuntimeErrorType.InsufficientQuota, match: sub('余额不足或无可用资源包') },
  { code: AgentRuntimeErrorType.InsufficientQuota, match: sub('用户额度不足') },
  { code: AgentRuntimeErrorType.InsufficientQuota, match: sub('预扣费额度失败') },
  { code: AgentRuntimeErrorType.InsufficientQuota, match: sub('请检查 API Key 余额是否充足') },
  {
    code: AgentRuntimeErrorType.InsufficientQuota,
    match: sub('You exceeded your current quota, please check your plan'),
  },
  {
    code: AgentRuntimeErrorType.InsufficientQuota,
    match: sub('You exceeded your current token quota'),
    note: 'Moonshot / kimi per-token quota',
  },
  {
    code: AgentRuntimeErrorType.InsufficientQuota,
    match: sub("You've reached your usage limit for this period"),
    note: 'Kimi coding plan usage cap',
  },
  {
    code: AgentRuntimeErrorType.InsufficientQuota,
    match: sub('depleted your monthly included credits'),
    note: 'HuggingFace via newapi',
  },
  {
    code: AgentRuntimeErrorType.InsufficientQuota,
    match: sub('reached your session usage limit, upgrade for higher limits'),
    note: 'Ollama cloud per-session cap',
  },
  {
    code: AgentRuntimeErrorType.InsufficientQuota,
    match: sub('Weekly usage limit reached'),
    note: 'opencodecodingplan rolling weekly plan cap (resets in N days — not retryable)',
  },
  {
    code: AgentRuntimeErrorType.InsufficientQuota,
    match: sub('This model is not available on your current plan'),
    note: 'Pawan.krd plan gating',
  },
  {
    code: AgentRuntimeErrorType.InsufficientQuota,
    match: sub('please make sure your account is in good standing'),
    note: 'Aliyun Bailian overdue',
  },
  {
    code: AgentRuntimeErrorType.InsufficientQuota,
    match: sub('your current token plan not support model'),
    note: 'MiniMax coding plan',
  },
  {
    code: AgentRuntimeErrorType.InsufficientQuota,
    match: sub('Monthly request limit exceeded'),
    note: 'LM Studio cloud monthly quota',
  },
  {
    code: AgentRuntimeErrorType.InsufficientQuota,
    match: sub('Your credit balance is too low to access the Anthropic API'),
  },
  { code: AgentRuntimeErrorType.InsufficientQuota, match: sub('quota exhausted') },
  {
    code: AgentRuntimeErrorType.InsufficientQuota,
    match: sub('Insufficient quota, please purchase a package or open the [overuse-switch]'),
  },
  {
    code: AgentRuntimeErrorType.InsufficientQuota,
    match: sub('Access restricted. Deposit required to unlock premium models'),
  },
  {
    code: AgentRuntimeErrorType.InsufficientQuota,
    match: sub('You have exceeded the 5-hour usage quota'),
    note: 'Volcengine coding plan rolling quota',
  },
  {
    code: AgentRuntimeErrorType.InsufficientQuota,
    match: sub('Insufficient account balance'),
    note: 'xiaomimimo zero balance',
  },
  {
    code: AgentRuntimeErrorType.InsufficientQuota,
    match: sub('达到使用量上限'),
    note: 'longcat AppId usage cap',
  },
  { code: AgentRuntimeErrorType.InsufficientQuota, match: sub('Token 额度不足') },
  {
    code: AgentRuntimeErrorType.InsufficientQuota,
    match: sub('usage limit exceeded (2056)'),
    note: 'MiniMax coding plan token-plan cap',
  },
  {
    code: AgentRuntimeErrorType.InsufficientQuota,
    match: sub('Sorry, you have reached the limit of the free model quota'),
  },
  {
    code: AgentRuntimeErrorType.InsufficientQuota,
    match: sub('has reached the set inference limit'),
  },
  {
    code: AgentRuntimeErrorType.InsufficientQuota,
    match: sub('chat pre-consumed quota failed, user quota:'),
    note: 'newapi-style proxy',
  },
  {
    code: AgentRuntimeErrorType.InsufficientQuota,
    match: sub('token quota is not enough, token remain quota:'),
  },
  {
    code: AgentRuntimeErrorType.InsufficientQuota,
    match: sub("exceeded today's quota for model"),
    note: 'ModelScope daily quota',
  },
  {
    code: AgentRuntimeErrorType.InsufficientQuota,
    match: sub('glm depleted for the current 5-hour window'),
  },
  {
    code: AgentRuntimeErrorType.InsufficientQuota,
    match: sub('data error, now time is smaller than order time'),
    note: 'qwen subscription expired',
  },
  {
    code: AgentRuntimeErrorType.InsufficientQuota,
    match: sub(
      'Please check if your API Key balance is sufficient, or if you are using an unverified API Key',
    ),
  },
  {
    code: AgentRuntimeErrorType.InsufficientQuota,
    match: sub('Prompt tokens limit exceeded:'),
    note: 'OpenRouter monthly key limit',
  },
  {
    code: AgentRuntimeErrorType.InsufficientQuota,
    match: sub('Exceeded soft user limit per query:'),
    note: 'OpenRouter / vsegpt per-query ceiling',
  },
  {
    code: AgentRuntimeErrorType.InsufficientQuota,
    match: sub('Key limit exceeded (monthly limit)'),
  },
  {
    code: AgentRuntimeErrorType.InsufficientQuota,
    match: sub('Potentially out of budget'),
    note: 'vsegpt budget rejection',
  },
  {
    code: AgentRuntimeErrorType.InsufficientQuota,
    match: sub('Credit required. To prevent abuse'),
    note: 'zenmux positive-balance gate',
  },
  {
    code: AgentRuntimeErrorType.InsufficientQuota,
    match: sub('has not been priced by the administrator'),
  },
  { code: AgentRuntimeErrorType.InsufficientQuota, match: sub('的价格尚未由管理员配置') },
  {
    code: AgentRuntimeErrorType.InsufficientQuota,
    match: sub('This IP address is already associated with another free account'),
    note: 'OpenAI free-account IP ban',
  },
  {
    code: AgentRuntimeErrorType.InsufficientQuota,
    match: sub('your account balance is insufficient, please recharge'),
  },
  {
    code: AgentRuntimeErrorType.InsufficientQuota,
    match: sub('Your account requires verification before using the API'),
    note: 'freemodel.dev phone verification',
  },

  // ─────────────────────────────────────────────────────────────────────────
  // RateLimitExceeded — short-window rate limit (transient, retryable)
  // ─────────────────────────────────────────────────────────────────────────
  {
    code: AgentRuntimeErrorType.RateLimitExceeded,
    match: sub('resource exhausted', { caseInsensitive: true }),
  },
  {
    code: AgentRuntimeErrorType.RateLimitExceeded,
    match: sub('resource has been exhausted', { caseInsensitive: true }),
  },
  {
    code: AgentRuntimeErrorType.RateLimitExceeded,
    match: sub('rate limit reached', { caseInsensitive: true }),
  },
  { code: AgentRuntimeErrorType.RateLimitExceeded, match: sub('rate_limit_exceeded') },
  {
    code: AgentRuntimeErrorType.RateLimitExceeded,
    match: sub('quota exceeded', { caseInsensitive: true }),
  },
  {
    code: AgentRuntimeErrorType.RateLimitExceeded,
    match: sub('too many requests', { caseInsensitive: true }),
  },
  {
    code: AgentRuntimeErrorType.RateLimitExceeded,
    match: sub('too many tokens', { caseInsensitive: true }),
  },
  { code: AgentRuntimeErrorType.RateLimitExceeded, match: sub('429 status code') },
  { code: AgentRuntimeErrorType.RateLimitExceeded, match: sub('Concurrency limit exceeded') },
  {
    code: AgentRuntimeErrorType.RateLimitExceeded,
    match: sub('reached organization TPD rate limit'),
  },
  {
    code: AgentRuntimeErrorType.RateLimitExceeded,
    match: sub("exceed your organization's rate limit"),
  },
  { code: AgentRuntimeErrorType.RateLimitExceeded, match: sub('tokens per minute (TPM)') },
  {
    code: AgentRuntimeErrorType.RateLimitExceeded,
    match: sub('Rate limit exceeded: free-models-'),
  },
  { code: AgentRuntimeErrorType.RateLimitExceeded, match: sub('Rate limit exceeded: limit_rpm/') },
  {
    code: AgentRuntimeErrorType.RateLimitExceeded,
    match: sub('Key limit exceeded (weekly limit)'),
  },
  { code: AgentRuntimeErrorType.RateLimitExceeded, match: sub('BYOK access to') },
  { code: AgentRuntimeErrorType.RateLimitExceeded, match: sub('您的账户已达到速率限制') },
  { code: AgentRuntimeErrorType.RateLimitExceeded, match: sub('AppChatReverse: Chat failed, 429') },
  {
    code: AgentRuntimeErrorType.RateLimitExceeded,
    match: sub('Your plan allows 1 concurrent request'),
  },
  { code: AgentRuntimeErrorType.RateLimitExceeded, match: sub('并发请求已达上限') },
  { code: AgentRuntimeErrorType.RateLimitExceeded, match: sub('TPM limit reached') },
  { code: AgentRuntimeErrorType.RateLimitExceeded, match: sub('您已达到默认总请求数限制') },
  {
    code: AgentRuntimeErrorType.RateLimitExceeded,
    match: sub('concurrency limit exceeded; wait for an active request to finish'),
  },
  {
    code: AgentRuntimeErrorType.RateLimitExceeded,
    match: sub('Request rate increased too quickly'),
  },

  // ─────────────────────────────────────────────────────────────────────────
  // ProviderServiceUnavailable — 503 / overload (transient)
  // ─────────────────────────────────────────────────────────────────────────
  {
    code: AgentRuntimeErrorType.ProviderServiceUnavailable,
    match: sub('Service temporarily unavailable'),
  },
  {
    code: AgentRuntimeErrorType.ProviderServiceUnavailable,
    match: sub('Upstream service temporarily unavailable'),
  },
  {
    code: AgentRuntimeErrorType.ProviderServiceUnavailable,
    match: sub('This model is currently experiencing high demand'),
  },
  { code: AgentRuntimeErrorType.ProviderServiceUnavailable, match: sub('服务暂时不可用') },
  { code: AgentRuntimeErrorType.ProviderServiceUnavailable, match: sub('所有供应商暂时不可用') },
  { code: AgentRuntimeErrorType.ProviderServiceUnavailable, match: sub('当前分组上游负载已饱和') },
  { code: AgentRuntimeErrorType.ProviderServiceUnavailable, match: sub('当前服务集群负载较高') },
  { code: AgentRuntimeErrorType.ProviderServiceUnavailable, match: sub('该模型当前访问量过大') },
  { code: AgentRuntimeErrorType.ProviderServiceUnavailable, match: sub('当前为整点高峰时段') },
  {
    code: AgentRuntimeErrorType.ProviderServiceUnavailable,
    match: sub('System is too busy now. Please try again later.'),
  },
  {
    code: AgentRuntimeErrorType.ProviderServiceUnavailable,
    match: sub('are cooling down via provider'),
  },
  {
    code: AgentRuntimeErrorType.ProviderServiceUnavailable,
    match: sub('The service may be temporarily overloaded, please try again later'),
  },
  {
    code: AgentRuntimeErrorType.ProviderServiceUnavailable,
    match: sub('All credentials for model'),
  },
  { code: AgentRuntimeErrorType.ProviderServiceUnavailable, match: sub('没有可用的内网节点') },
  {
    code: AgentRuntimeErrorType.ProviderServiceUnavailable,
    match: sub('<title>503 Service Temporarily Unavailable</title>'),
  },
  {
    code: AgentRuntimeErrorType.ProviderServiceUnavailable,
    match: sub('<title>502 Bad Gateway</title>'),
  },
  {
    code: AgentRuntimeErrorType.ProviderServiceUnavailable,
    match: sub('503 status code (no body)'),
  },
  { code: AgentRuntimeErrorType.ProviderServiceUnavailable, match: sub('526 <!DOCTYPE html>') },
  {
    code: AgentRuntimeErrorType.ProviderServiceUnavailable,
    match: sub('Our servers are currently overloaded'),
  },
  { code: AgentRuntimeErrorType.ProviderServiceUnavailable, match: sub('system cpu overloaded') },
  { code: AgentRuntimeErrorType.ProviderServiceUnavailable, match: sub('system disk overloaded') },
  {
    code: AgentRuntimeErrorType.ProviderServiceUnavailable,
    match: sub('unknown error in the model inference server'),
    note: 'ppio opaque inference error',
  },
  {
    code: AgentRuntimeErrorType.ProviderServiceUnavailable,
    match: sub('已被所有启用端点禁用'),
    note: 'lconai model disabled on every endpoint',
  },
  { code: AgentRuntimeErrorType.ProviderServiceUnavailable, match: sub('502 status code') },
  { code: AgentRuntimeErrorType.ProviderServiceUnavailable, match: sub('502: Bad gateway') },
  { code: AgentRuntimeErrorType.ProviderServiceUnavailable, match: sub('502 <!DOCTYPE html>') },
  { code: AgentRuntimeErrorType.ProviderServiceUnavailable, match: sub('503 Gateway Error') },

  // ─────────────────────────────────────────────────────────────────────────
  // ProviderNetworkError — connection / timeout
  // ─────────────────────────────────────────────────────────────────────────
  { code: AgentRuntimeErrorType.ProviderNetworkError, match: sub('ETIMEDOUT') },
  { code: AgentRuntimeErrorType.ProviderNetworkError, match: sub('Request timed out') },
  { code: AgentRuntimeErrorType.ProviderNetworkError, match: sub('request to http://') },
  { code: AgentRuntimeErrorType.ProviderNetworkError, match: sub('request to https://') },
  { code: AgentRuntimeErrorType.ProviderNetworkError, match: sub('self-signed certificate') },
  { code: AgentRuntimeErrorType.ProviderNetworkError, match: sub('Network connection lost') },
  {
    code: AgentRuntimeErrorType.ProviderNetworkError,
    // OpenAI/Anthropic SDK APIConnectionError wrapper — the underlying
    // ECONNREFUSED / socket failure is buried in the nested cause, only the
    // generic "Connection error." surfaces on the top-level message.
    match: sub('Connection error.'),
  },

  // ─────────────────────────────────────────────────────────────────────────
  // StateStorePersistError — Redis / Upstash agent-state store (NOT the LLM
  // provider). ioredis aborts, request-size cap, suspended DB.
  // ─────────────────────────────────────────────────────────────────────────
  {
    code: AgentRuntimeErrorType.StateStorePersistError,
    match: sub('Command aborted due to connection close'),
    note: 'ioredis aborts queued commands when the Upstash connection drops.',
  },
  {
    code: AgentRuntimeErrorType.StateStorePersistError,
    match: sub('max request size exceeded'),
  },
  {
    code: AgentRuntimeErrorType.StateStorePersistError,
    match: sub('database has been suspended'),
  },

  // ─────────────────────────────────────────────────────────────────────────
  // NoAvailableChannel — router / proxy has no upstream
  // ─────────────────────────────────────────────────────────────────────────
  { code: AgentRuntimeErrorType.NoAvailableChannel, match: sub('No available accounts') },
  { code: AgentRuntimeErrorType.NoAvailableChannel, match: sub('No endpoints found') },
  {
    code: AgentRuntimeErrorType.NoAvailableChannel,
    match: sub('No allowed providers are available'),
  },
  {
    code: AgentRuntimeErrorType.NoAvailableChannel,
    match: sub('No endpoints available matching your guardrail'),
  },
  { code: AgentRuntimeErrorType.NoAvailableChannel, match: sub('no available channels for model') },
  { code: AgentRuntimeErrorType.NoAvailableChannel, match: sub('No available channel for model') },
  { code: AgentRuntimeErrorType.NoAvailableChannel, match: sub('无可用渠道') },
  {
    code: AgentRuntimeErrorType.NoAvailableChannel,
    match: sub('All upstream channels are currently unavailable'),
  },
  {
    code: AgentRuntimeErrorType.NoAvailableChannel,
    match: sub('No accounts in current group support model'),
  },
  {
    code: AgentRuntimeErrorType.NoAvailableChannel,
    match: sub('No available keys in pool'),
    note: 'newapi key pool exhausted',
  },
  { code: AgentRuntimeErrorType.NoAvailableChannel, match: sub('no_valid_channel_error') },
  {
    code: AgentRuntimeErrorType.NoAvailableChannel,
    match: sub('The channel selected by channel affinity has been disabled'),
  },
  {
    code: AgentRuntimeErrorType.NoAvailableChannel,
    match: sub('ratio or price is not configured'),
  },
  { code: AgentRuntimeErrorType.NoAvailableChannel, match: sub('倍率或价格未配置') },
  {
    code: AgentRuntimeErrorType.NoAvailableChannel,
    match: sub('upstream rejected the request payload'),
    note: 'freethe routing short-circuit',
  },

  // ─────────────────────────────────────────────────────────────────────────
  // ModelNotFound
  // ─────────────────────────────────────────────────────────────────────────
  {
    code: AgentRuntimeErrorType.ModelNotFound,
    match: sub('does not exist or you do not have access to it'),
  },
  { code: AgentRuntimeErrorType.ModelNotFound, match: sub('does not exist') },
  {
    code: AgentRuntimeErrorType.ModelNotFound,
    match: sub('Model not found, inaccessible, and/or not deployed'),
  },
  { code: AgentRuntimeErrorType.ModelNotFound, match: sub('The requested model is not supported') },
  { code: AgentRuntimeErrorType.ModelNotFound, match: sub('已下线，请切换到') },
  {
    code: AgentRuntimeErrorType.ModelNotFound,
    match: sub('Not found the model'),
    note: 'moonshot',
  },
  {
    code: AgentRuntimeErrorType.ModelNotFound,
    match: sub('is no longer available as a free model'),
  },
  { code: AgentRuntimeErrorType.ModelNotFound, match: sub('is not a valid model ID') },
  {
    code: AgentRuntimeErrorType.ModelNotFound,
    match: sub('reached its end of life on'),
    note: 'newapi-style 410 Gone',
  },

  // ─────────────────────────────────────────────────────────────────────────
  // InvalidProviderAPIKey
  // ─────────────────────────────────────────────────────────────────────────
  { code: AgentRuntimeErrorType.InvalidProviderAPIKey, match: sub('Invalid token (request id:') },
  { code: AgentRuntimeErrorType.InvalidProviderAPIKey, match: sub('您多次使用无效令牌') },
  {
    code: AgentRuntimeErrorType.InvalidProviderAPIKey,
    match: sub('You have used invalid tokens multiple times, please wait'),
  },
  {
    code: AgentRuntimeErrorType.InvalidProviderAPIKey,
    match: sub('auth_unavailable: no auth available'),
    note: 'cliproxyapi credential removed',
  },
  {
    code: AgentRuntimeErrorType.InvalidProviderAPIKey,
    match: sub('API key was reported as leaked'),
  },
  {
    code: AgentRuntimeErrorType.InvalidProviderAPIKey,
    match: sub('API key expired. Please renew the API key'),
  },
  {
    code: AgentRuntimeErrorType.InvalidProviderAPIKey,
    match: sub('API Key not found. Please pass a valid API key'),
  },
  { code: AgentRuntimeErrorType.InvalidProviderAPIKey, match: sub('this key is not enabled') },
  {
    code: AgentRuntimeErrorType.InvalidProviderAPIKey,
    match: sub('invalid_api_key', { caseInsensitive: true }),
  },
  {
    code: AgentRuntimeErrorType.InvalidProviderAPIKey,
    match: sub('invalidapikey', { caseInsensitive: true }),
  },

  // ─────────────────────────────────────────────────────────────────────────
  // InvalidGithubToken / InvalidGithubCopilotToken
  // ─────────────────────────────────────────────────────────────────────────
  {
    code: AgentRuntimeErrorType.InvalidGithubToken,
    match: sub('Invalid GitHub Personal Access Token'),
  },
  {
    code: AgentRuntimeErrorType.InvalidGithubCopilotToken,
    match: sub('No GitHub Copilot subscription or access denied'),
  },

  // ─────────────────────────────────────────────────────────────────────────
  // InvalidBedrockCredentials
  // ─────────────────────────────────────────────────────────────────────────
  {
    code: AgentRuntimeErrorType.InvalidBedrockCredentials,
    match: sub('The request signature we calculated does not match'),
    note: 'AWS SigV4 mismatch',
  },

  // ─────────────────────────────────────────────────────────────────────────
  // PermissionDenied
  // ─────────────────────────────────────────────────────────────────────────
  {
    code: AgentRuntimeErrorType.PermissionDenied,
    match: sub('Your project has been denied access'),
  },
  { code: AgentRuntimeErrorType.PermissionDenied, match: sub('This token has no access to model') },
  { code: AgentRuntimeErrorType.PermissionDenied, match: sub('该令牌无权访问模型') },
  { code: AgentRuntimeErrorType.PermissionDenied, match: sub('您的 IP 不在令牌允许访问的列表中') },

  // ─────────────────────────────────────────────────────────────────────────
  // AccountDeactivated
  // ─────────────────────────────────────────────────────────────────────────
  {
    code: AgentRuntimeErrorType.AccountDeactivated,
    match: sub('account has been deactivated', { caseInsensitive: true }),
  },
  {
    code: AgentRuntimeErrorType.AccountDeactivated,
    match: sub('account has been suspended', { caseInsensitive: true }),
  },
  {
    code: AgentRuntimeErrorType.AccountDeactivated,
    match: sub('account has been disabled', { caseInsensitive: true }),
  },
  {
    code: AgentRuntimeErrorType.AccountDeactivated,
    match: sub('account is disabled', { caseInsensitive: true }),
  },

  // ─────────────────────────────────────────────────────────────────────────
  // CapabilityNotSupported
  // ─────────────────────────────────────────────────────────────────────────
  { code: AgentRuntimeErrorType.CapabilityNotSupported, match: sub('not implemented') },
  { code: AgentRuntimeErrorType.CapabilityNotSupported, match: sub('The model is not a VLM') },
  { code: AgentRuntimeErrorType.CapabilityNotSupported, match: sub('is not a multimodal model') },
  {
    code: AgentRuntimeErrorType.CapabilityNotSupported,
    match: sub('Function call is not supported for this model'),
  },
  {
    code: AgentRuntimeErrorType.CapabilityNotSupported,
    match: sub('`tool calling` is not supported with this model'),
  },
  {
    code: AgentRuntimeErrorType.CapabilityNotSupported,
    match: sub('This model does not support assistant message prefill'),
  },
  {
    code: AgentRuntimeErrorType.CapabilityNotSupported,
    match: sub('Tools are only supported on chat models'),
  },
  {
    code: AgentRuntimeErrorType.CapabilityNotSupported,
    match: sub('Only google search tool and maps imagery grounding tool is supported'),
  },
  {
    code: AgentRuntimeErrorType.CapabilityNotSupported,
    match: sub('--enable-auto-tool-choice and --tool-call-parser to be set'),
    note: 'self-hosted vLLM missing tool-call flags',
  },
  {
    code: AgentRuntimeErrorType.CapabilityNotSupported,
    match: sub('does not support tool calling.'),
  },

  // ─────────────────────────────────────────────────────────────────────────
  // ContentModeration
  // ─────────────────────────────────────────────────────────────────────────
  {
    code: AgentRuntimeErrorType.ContentModeration,
    match: sub('violation of provider Terms Of Service'),
  },
  {
    code: AgentRuntimeErrorType.ContentModeration,
    match: sub('Content violates usage guidelines'),
  },
  { code: AgentRuntimeErrorType.ContentModeration, match: sub('Attention Required! | Cloudflare') },
  { code: AgentRuntimeErrorType.ContentModeration, match: sub('Sorry, you have been blocked') },
  { code: AgentRuntimeErrorType.ContentModeration, match: sub('抱歉，您所输入的内容含有违规信息') },
  {
    code: AgentRuntimeErrorType.ContentModeration,
    match: sub('Content Exists Risk'),
    note: 'DeepSeek',
  },
  {
    code: AgentRuntimeErrorType.ContentModeration,
    match: sub('Input data may contain inappropriate content'),
  },
  {
    code: AgentRuntimeErrorType.ContentModeration,
    match: sub('Your request contains prohibited content'),
    note: 'Anthropic',
  },
  {
    code: AgentRuntimeErrorType.ContentModeration,
    match: sub('DataInspectionFailed: Input text data may contain inappropriate content'),
    note: 'Aliyun',
  },
  {
    code: AgentRuntimeErrorType.ContentModeration,
    match: sub('This content was flagged for possible cybersecurity risk'),
    note: 'OpenAI Trusted Access',
  },
  {
    code: AgentRuntimeErrorType.ContentModeration,
    match: sub('output new_sensitive (1027)'),
    note: 'MiniMax',
  },
  { code: AgentRuntimeErrorType.ContentModeration, match: sub('sensitive_words_detected') },
  {
    code: AgentRuntimeErrorType.ContentModeration,
    match: sub('Output data may contain inappropriate content'),
    note: 'sensenova output-side',
  },

  // ─────────────────────────────────────────────────────────────────────────
  // InvalidRequestFormat — provider rejected as malformed
  // ─────────────────────────────────────────────────────────────────────────
  {
    code: AgentRuntimeErrorType.InvalidRequestFormat,
    match: sub('text content blocks must be non-empty'),
  },
  {
    code: AgentRuntimeErrorType.InvalidRequestFormat,
    match: sub("'tools' : maximum number of items"),
  },
  { code: AgentRuntimeErrorType.InvalidRequestFormat, match: sub('无效的请求') },
  { code: AgentRuntimeErrorType.InvalidRequestFormat, match: sub('未正常接收到prompt参数') },
  {
    code: AgentRuntimeErrorType.InvalidRequestFormat,
    match: sub('image URLs are not currently supported'),
    note: 'Ollama cloud requires base64',
  },
  {
    code: AgentRuntimeErrorType.InvalidRequestFormat,
    match: sub('Expecting property name enclosed in double quotes'),
  },
  { code: AgentRuntimeErrorType.InvalidRequestFormat, match: sub('Expecting value:') },
  { code: AgentRuntimeErrorType.InvalidRequestFormat, match: sub("Expecting ',' delimiter:") },
  {
    code: AgentRuntimeErrorType.InvalidRequestFormat,
    match: sub('Unterminated string starting at'),
  },
  {
    code: AgentRuntimeErrorType.InvalidRequestFormat,
    match: sub('Expected string, received null'),
    note: 'Zod: model returned null in tool call',
  },
  {
    code: AgentRuntimeErrorType.InvalidRequestFormat,
    match: sub('parameter of the code model must be in JSON format'),
  },
  {
    code: AgentRuntimeErrorType.InvalidRequestFormat,
    match: sub("Invalid value: ''. Supported values are: 'apply_patch_call'"),
    note: 'non-spec-compliant openai-compat proxy',
  },
  {
    code: AgentRuntimeErrorType.InvalidRequestFormat,
    match: sub("'/required': got null, want array"),
  },
  {
    code: AgentRuntimeErrorType.InvalidRequestFormat,
    match: sub('Last message must be from user'),
    note: 'Jina embeddings chat-format mismatch',
  },
  {
    code: AgentRuntimeErrorType.InvalidRequestFormat,
    match: sub('function call turn comes immediately after a user turn'),
    note: 'Gemini tool-call ordering',
  },
  { code: AgentRuntimeErrorType.InvalidRequestFormat, match: sub('Invalid image URL: ') },
  {
    code: AgentRuntimeErrorType.InvalidRequestFormat,
    match: sub('model should be in provider/model format'),
  },
  {
    code: AgentRuntimeErrorType.InvalidRequestFormat,
    match: sub('AiError: AiError: Invalid input'),
    note: 'Cloudflare AI Workers opaque validation',
  },
  {
    code: AgentRuntimeErrorType.InvalidRequestFormat,
    match: sub('Unsupported parameter: safety_identifier'),
  },
  {
    code: AgentRuntimeErrorType.InvalidRequestFormat,
    match: sub('(type=extra_forbidden)'),
    note: 'strict pydantic proxies reject extra fields',
  },
  {
    code: AgentRuntimeErrorType.InvalidRequestFormat,
    match: sub('invalid function arguments json string'),
    note: 'MiniMax 2013',
  },
  { code: AgentRuntimeErrorType.InvalidRequestFormat, match: sub('fail to decode image config') },
  { code: AgentRuntimeErrorType.InvalidRequestFormat, match: sub('图片输入格式/解析错误') },
  // Gemini schema bridge bugs from third-party openai-compat proxies that forward
  // `parameters` without converting JSON Schema → Google Schema. Upstream proxy
  // bugs, not harness bugs.
  {
    code: AgentRuntimeErrorType.InvalidRequestFormat,
    match: sub('For schema with properties, schema type should be OBJECT'),
  },
  {
    code: AgentRuntimeErrorType.InvalidRequestFormat,
    match: sub('specified incorrect schema type field'),
  },
  {
    code: AgentRuntimeErrorType.InvalidRequestFormat,
    match: sub("didn't specify the schema type field"),
  },
  {
    code: AgentRuntimeErrorType.InvalidRequestFormat,
    match: sub('Proto field is not repeating, cannot start list'),
  },
  { code: AgentRuntimeErrorType.InvalidRequestFormat, match: sub('Unknown name "definitions"') },
  { code: AgentRuntimeErrorType.InvalidRequestFormat, match: sub("function_response.response' (") },

  // ─────────────────────────────────────────────────────────────────────────
  // UserConfigError
  // ─────────────────────────────────────────────────────────────────────────
  {
    code: AgentRuntimeErrorType.UserConfigError,
    match: sub('OPENAI_API_VERSION environment variable is missing'),
    note: 'Azure OpenAI missing api-version',
  },
  {
    code: AgentRuntimeErrorType.UserConfigError,
    match: sub('All providers have been ignored. To change your default ignored providers'),
    note: 'OpenRouter privacy settings',
  },
  {
    code: AgentRuntimeErrorType.UserConfigError,
    match: sub('OpenAI API is only accessible over HTTPS'),
  },
  {
    code: AgentRuntimeErrorType.UserConfigError,
    match: sub("endpoint 'v1/responses' not provided"),
    note: 'proxy missing Responses API',
  },
  {
    code: AgentRuntimeErrorType.UserConfigError,
    match: sub('Invalid URL (POST /v1/v1beta'),
    note: 'user pasted /v1/ prefix into Gemini config',
  },
  {
    code: AgentRuntimeErrorType.UserConfigError,
    match: sub('is not allowed for this virtual key'),
  },

  // ─────────────────────────────────────────────────────────────────────────
  // UpstreamGatewayError — proxy / gateway-layer failure (openresty, litellm,
  // HTML error bodies, Cloudflare 525). Distinct from the provider's own
  // service; usually transient. Split out of the ProviderBizError catch-all.
  // ─────────────────────────────────────────────────────────────────────────
  {
    code: AgentRuntimeErrorType.UpstreamGatewayError,
    match: sub('<center>openresty</center>'),
    note: 'user-configured proxy returning HTML',
  },
  { code: AgentRuntimeErrorType.UpstreamGatewayError, match: sub('litellm.') },
  { code: AgentRuntimeErrorType.UpstreamGatewayError, match: sub('403 <!DOCTYPE html>') },
  { code: AgentRuntimeErrorType.UpstreamGatewayError, match: sub('404 <!DOCTYPE html>') },
  {
    code: AgentRuntimeErrorType.UpstreamGatewayError,
    match: sub('525 <!DOCTYPE html>'),
    note: 'Cloudflare 525 SSL handshake',
  },

  // ─────────────────────────────────────────────────────────────────────────
  // UpstreamMalformedResponse — provider returned a malformed / unparseable
  // payload (Go re-marshal failure, bad tool-call JSON, upstream Python
  // TypeError). Not retryable. Split out of ProviderBizError.
  // ─────────────────────────────────────────────────────────────────────────
  {
    code: AgentRuntimeErrorType.UpstreamMalformedResponse,
    match: sub('failed to marshal request body to JSON'),
    note: 'upstream Go gateway re-marshal failure on non-UTF-8 / lone-surrogate bytes',
  },
  {
    code: AgentRuntimeErrorType.UpstreamMalformedResponse,
    match: sub('lone leading surrogate'),
    note: 'invalid conversation JSON: lone surrogate in tool-call output',
  },
  {
    code: AgentRuntimeErrorType.UpstreamMalformedResponse,
    match: sub("Internal server error: unhashable type: '"),
    note: 'nvidia / nvidia_custom upstream Python TypeError',
  },
  {
    code: AgentRuntimeErrorType.UpstreamMalformedResponse,
    match: sub('Failed to parse fc related info to json format'),
    note: 'internlm tool-call parser failure',
  },
  {
    code: AgentRuntimeErrorType.UpstreamMalformedResponse,
    match: sub('codewhisperer#ValidationException'),
    note: 'kiro / AWS CodeWhisperer proxy malformed payload',
  },

  // ─────────────────────────────────────────────────────────────────────────
  // UpstreamHttpError — bare upstream HTTP error with no further context.
  // Split out of ProviderBizError. (400 / 422 here are candidates for a future
  // `request`-category split; tracked separately.)
  // ─────────────────────────────────────────────────────────────────────────
  { code: AgentRuntimeErrorType.UpstreamHttpError, match: sub('400 status code') },
  { code: AgentRuntimeErrorType.UpstreamHttpError, match: sub('403 status code') },
  { code: AgentRuntimeErrorType.UpstreamHttpError, match: sub('404 status code') },
  { code: AgentRuntimeErrorType.UpstreamHttpError, match: sub('413 Request Entity Too Large') },

  // ─────────────────────────────────────────────────────────────────────────
  // ProviderBizError — generic upstream wrappers that don't fit elsewhere. The
  // final provider catch-all; `refineErrorCode` + the HTTP-status fallback try
  // to reclassify these into a more specific code before this bucket is kept.
  // ─────────────────────────────────────────────────────────────────────────
  { code: AgentRuntimeErrorType.ProviderBizError, match: sub('Upstream request failed') },
  { code: AgentRuntimeErrorType.ProviderBizError, match: sub('Provider returned error') },
  { code: AgentRuntimeErrorType.ProviderBizError, match: sub('bad_response_status_code') },
  { code: AgentRuntimeErrorType.ProviderBizError, match: sub('bad response status code') },
  { code: AgentRuntimeErrorType.ProviderBizError, match: sub('convert_request_failed') },
  { code: AgentRuntimeErrorType.ProviderBizError, match: sub('failed to parse request') },
  { code: AgentRuntimeErrorType.ProviderBizError, match: sub('upstream error: do request failed') },
  { code: AgentRuntimeErrorType.ProviderBizError, match: sub('Internal Server Error (ref:') },
  { code: AgentRuntimeErrorType.ProviderBizError, match: sub('410 status code (no body)') },
  { code: AgentRuntimeErrorType.ProviderBizError, match: sub('402 status code') },
  {
    code: AgentRuntimeErrorType.ProviderBizError,
    match: sub('[upstream:/v1/messages] Upstream returned HTTP'),
  },
  { code: AgentRuntimeErrorType.ProviderBizError, match: sub('上游请求参数无效') },

  // ─────────────────────────────────────────────────────────────────────────
  // ContextEnginePipelineError — a context-engine pipeline processor crashed.
  // Sits before the generic JS-crash fallbacks so "Processor [X] execution
  // failed: Cannot read properties …" is attributed to the pipeline, not the
  // raw TypeError below.
  // ─────────────────────────────────────────────────────────────────────────
  {
    code: AgentRuntimeErrorType.ContextEnginePipelineError,
    match: sub('Processor ['),
    note: 'context-engine PipelineError: `Processor [<name>] execution failed`.',
  },

  // ─────────────────────────────────────────────────────────────────────────
  // AgentRuntimeError — harness-side JS runtime crashes (V8 TypeError /
  // RangeError). Our bugs, not upstream provider errors, so they stay LAST: a
  // more specific provider/harness pattern above wins first, and only genuine
  // bare crashes fall through to here.
  // ─────────────────────────────────────────────────────────────────────────
  { code: AgentRuntimeErrorType.AgentRuntimeError, match: sub('is not a function') },
  { code: AgentRuntimeErrorType.AgentRuntimeError, match: sub('Cannot read properties of') },
  { code: AgentRuntimeErrorType.AgentRuntimeError, match: sub('Maximum call stack size exceeded') },
  {
    code: AgentRuntimeErrorType.AgentRuntimeError,
    match: sub('[object Object]'),
    note: 'harness stringified an error object instead of extracting its message',
  },
];

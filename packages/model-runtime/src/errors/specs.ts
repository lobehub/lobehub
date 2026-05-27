import type { ILobeAgentRuntimeErrorType } from '@lobechat/types';
import { AgentRuntimeErrorType } from '@lobechat/types';

import type { ErrorAttribution, ErrorCategory, ErrorSeverity } from './taxonomy';

export interface ErrorCodeSpec {
  attribution: ErrorAttribution;
  category: ErrorCategory;
  code: ILobeAgentRuntimeErrorType;
  /** Whether this error counts toward operational failure metrics. */
  countAsFailure: boolean;

  /** Short English description for dashboards / docs. */
  description: string;
  /** HTTP status code returned to the client. */
  httpStatus: number;

  /**
   * Stable numeric identifier surfaced as `E<numericId>` (e.g. `E1001`).
   *
   * Append-only: once assigned, a (code, numericId) pair must never change so
   * that external docs / support tickets / SDKs can reference it long-term.
   * The leading digit must match `CATEGORY_NUMERIC_PREFIX[category]`; the
   * remaining digits are assigned sequentially within the category bucket.
   */
  numericId: number;

  /** Whether transport-level retry is allowed. */
  retryable: boolean;

  severity: ErrorSeverity;
}

type SpecMap = Partial<Record<ILobeAgentRuntimeErrorType, ErrorCodeSpec>>;

/**
 * Single source of truth for every runtime error code.
 *
 * To add a new code:
 *   1. Add it to `AgentRuntimeErrorType` in `@lobechat/types/agentRuntime.ts`.
 *   2. Add a spec entry here.
 *   3. Add a locale key `response.<code>` in `src/locales/default/error.ts`.
 *   4. (If user-side) add upstream message patterns in `./patterns.ts`.
 */
export const ERROR_CODE_SPECS: SpecMap = {
  // ─── 1xxx Auth / Credentials ──────────────────────────────────────────
  [AgentRuntimeErrorType.InvalidProviderAPIKey]: {
    code: AgentRuntimeErrorType.InvalidProviderAPIKey,
    numericId: 1001,
    category: 'auth',
    severity: 'warning',
    attribution: 'user',
    httpStatus: 401,
    retryable: false,
    countAsFailure: false,
    description: 'API key is invalid, revoked, or rejected by the upstream auth.',
  },
  [AgentRuntimeErrorType.InvalidGithubToken]: {
    code: AgentRuntimeErrorType.InvalidGithubToken,
    numericId: 1002,
    category: 'auth',
    severity: 'warning',
    attribution: 'user',
    httpStatus: 401,
    retryable: false,
    countAsFailure: false,
    description: 'GitHub Personal Access Token is invalid or revoked.',
  },
  [AgentRuntimeErrorType.InvalidGithubCopilotToken]: {
    code: AgentRuntimeErrorType.InvalidGithubCopilotToken,
    numericId: 1003,
    category: 'auth',
    severity: 'warning',
    attribution: 'user',
    httpStatus: 401,
    retryable: false,
    countAsFailure: false,
    description: 'No active GitHub Copilot subscription or access denied.',
  },
  [AgentRuntimeErrorType.InvalidBedrockCredentials]: {
    code: AgentRuntimeErrorType.InvalidBedrockCredentials,
    numericId: 1004,
    category: 'auth',
    severity: 'warning',
    attribution: 'user',
    httpStatus: 401,
    retryable: false,
    countAsFailure: false,
    description: 'AWS Bedrock credentials are invalid or signature mismatch.',
  },
  [AgentRuntimeErrorType.InvalidVertexCredentials]: {
    code: AgentRuntimeErrorType.InvalidVertexCredentials,
    numericId: 1005,
    category: 'auth',
    severity: 'warning',
    attribution: 'user',
    httpStatus: 401,
    retryable: false,
    countAsFailure: false,
    description: 'Google Vertex credentials are invalid or service-account misconfigured.',
  },
  [AgentRuntimeErrorType.PermissionDenied]: {
    code: AgentRuntimeErrorType.PermissionDenied,
    numericId: 1006,
    category: 'auth',
    severity: 'warning',
    attribution: 'user',
    httpStatus: 403,
    retryable: false,
    countAsFailure: false,
    description: 'Provider denied access (project blocked, model gated, etc.).',
  },
  [AgentRuntimeErrorType.AccountDeactivated]: {
    code: AgentRuntimeErrorType.AccountDeactivated,
    numericId: 1007,
    category: 'auth',
    severity: 'warning',
    attribution: 'user',
    httpStatus: 403,
    retryable: false,
    countAsFailure: false,
    description: 'Provider account is suspended or deactivated.',
  },
  [AgentRuntimeErrorType.LocationNotSupportError]: {
    code: AgentRuntimeErrorType.LocationNotSupportError,
    numericId: 1008,
    category: 'auth',
    severity: 'warning',
    attribution: 'user',
    httpStatus: 403,
    retryable: false,
    countAsFailure: false,
    description: 'Provider unavailable from the caller geographic region.',
  },

  // ─── 2xxx Quota / Billing ─────────────────────────────────────────────
  [AgentRuntimeErrorType.InsufficientQuota]: {
    code: AgentRuntimeErrorType.InsufficientQuota,
    numericId: 2001,
    category: 'quota',
    severity: 'warning',
    attribution: 'user',
    httpStatus: 429,
    retryable: false,
    countAsFailure: false,
    description: 'Account balance or billing quota exhausted.',
  },

  // ─── 3xxx Capacity ────────────────────────────────────────────────────
  [AgentRuntimeErrorType.RateLimitExceeded]: {
    code: AgentRuntimeErrorType.RateLimitExceeded,
    numericId: 3001,
    category: 'capacity',
    severity: 'warning',
    attribution: 'provider',
    httpStatus: 429,
    retryable: true,
    countAsFailure: false,
    description: 'Short-window rate limit (RPM / TPM / concurrency) reached.',
  },
  [AgentRuntimeErrorType.ProviderServiceUnavailable]: {
    code: AgentRuntimeErrorType.ProviderServiceUnavailable,
    numericId: 3002,
    category: 'capacity',
    severity: 'warning',
    attribution: 'provider',
    httpStatus: 503,
    retryable: true,
    countAsFailure: false,
    description: 'Upstream returned 503 / overloaded / temporarily unavailable.',
  },
  [AgentRuntimeErrorType.NoAvailableChannel]: {
    code: AgentRuntimeErrorType.NoAvailableChannel,
    numericId: 3003,
    category: 'capacity',
    severity: 'warning',
    attribution: 'provider',
    httpStatus: 503,
    retryable: false,
    countAsFailure: false,
    description: 'Proxy / router has no available channel or key for the model.',
  },
  [AgentRuntimeErrorType.OllamaServiceUnavailable]: {
    code: AgentRuntimeErrorType.OllamaServiceUnavailable,
    numericId: 3004,
    category: 'capacity',
    severity: 'warning',
    attribution: 'user',
    httpStatus: 472,
    retryable: false,
    countAsFailure: false,
    description: 'Local Ollama service is not reachable.',
  },
  [AgentRuntimeErrorType.ComfyUIServiceUnavailable]: {
    code: AgentRuntimeErrorType.ComfyUIServiceUnavailable,
    numericId: 3005,
    category: 'capacity',
    severity: 'warning',
    attribution: 'user',
    httpStatus: 472,
    retryable: false,
    countAsFailure: false,
    description: 'Local ComfyUI service is not reachable.',
  },

  // ─── 4xxx Request / Model ─────────────────────────────────────────────
  [AgentRuntimeErrorType.ModelNotFound]: {
    code: AgentRuntimeErrorType.ModelNotFound,
    numericId: 4001,
    category: 'request',
    severity: 'warning',
    attribution: 'user',
    httpStatus: 404,
    retryable: false,
    countAsFailure: false,
    description: 'Requested model does not exist or the token has no access to it.',
  },
  [AgentRuntimeErrorType.ExceededContextWindow]: {
    code: AgentRuntimeErrorType.ExceededContextWindow,
    numericId: 4002,
    category: 'request',
    severity: 'info',
    attribution: 'user',
    httpStatus: 400,
    retryable: false,
    countAsFailure: false,
    description: 'Prompt + tool payload exceeds the model context window.',
  },
  [AgentRuntimeErrorType.ExceededToolLimit]: {
    code: AgentRuntimeErrorType.ExceededToolLimit,
    numericId: 4003,
    category: 'request',
    severity: 'info',
    attribution: 'user',
    httpStatus: 400,
    retryable: false,
    countAsFailure: false,
    description: 'Tools array exceeds the configured count or payload limit.',
  },
  [AgentRuntimeErrorType.CapabilityNotSupported]: {
    code: AgentRuntimeErrorType.CapabilityNotSupported,
    numericId: 4004,
    category: 'request',
    severity: 'info',
    attribution: 'user',
    httpStatus: 400,
    retryable: false,
    countAsFailure: false,
    description: 'Model does not support the requested capability (VLM / tool / prefill).',
  },
  [AgentRuntimeErrorType.InvalidRequestFormat]: {
    code: AgentRuntimeErrorType.InvalidRequestFormat,
    numericId: 4005,
    category: 'request',
    severity: 'warning',
    attribution: 'user',
    httpStatus: 400,
    retryable: false,
    countAsFailure: false,
    description: 'Upstream rejected the request as malformed (bad JSON / schema / parameters).',
  },

  // ─── 5xxx Safety ──────────────────────────────────────────────────────
  [AgentRuntimeErrorType.ContentModeration]: {
    code: AgentRuntimeErrorType.ContentModeration,
    numericId: 5001,
    category: 'safety',
    severity: 'info',
    attribution: 'user',
    httpStatus: 451,
    retryable: false,
    countAsFailure: false,
    description: 'Upstream content-safety filter rejected the input or output.',
  },

  // ─── 6xxx Network ─────────────────────────────────────────────────────
  [AgentRuntimeErrorType.ProviderNetworkError]: {
    code: AgentRuntimeErrorType.ProviderNetworkError,
    numericId: 6001,
    category: 'network',
    severity: 'warning',
    attribution: 'system',
    httpStatus: 504,
    retryable: true,
    countAsFailure: false,
    description: 'Connection timeout / network drop talking to the provider.',
  },

  // ─── 7xxx Stream / Runtime ────────────────────────────────────────────
  [AgentRuntimeErrorType.StreamChunkError]: {
    code: AgentRuntimeErrorType.StreamChunkError,
    numericId: 7001,
    category: 'stream',
    severity: 'error',
    attribution: 'harness',
    httpStatus: 500,
    retryable: false,
    countAsFailure: true,
    description: 'Failed to parse or process a streaming chunk from the provider.',
  },
  [AgentRuntimeErrorType.OperationInactivityTimeout]: {
    code: AgentRuntimeErrorType.OperationInactivityTimeout,
    numericId: 7002,
    category: 'stream',
    severity: 'error',
    attribution: 'harness',
    httpStatus: 504,
    retryable: false,
    countAsFailure: true,
    description: 'Gateway watchdog killed an idle agent operation.',
  },
  [AgentRuntimeErrorType.ConversationParentMissing]: {
    code: AgentRuntimeErrorType.ConversationParentMissing,
    numericId: 7003,
    category: 'stream',
    severity: 'error',
    attribution: 'harness',
    httpStatus: 500,
    retryable: false,
    countAsFailure: true,
    description: 'Conversation chain broken because an assistant/tool message lost its parent.',
  },

  // ─── 8xxx Provider (catch-all) ────────────────────────────────────────
  [AgentRuntimeErrorType.AgentRuntimeError]: {
    code: AgentRuntimeErrorType.AgentRuntimeError,
    numericId: 8001,
    category: 'provider',
    severity: 'error',
    attribution: 'harness',
    httpStatus: 470,
    retryable: false,
    countAsFailure: true,
    description: 'Generic Agent Runtime module error.',
  },
  [AgentRuntimeErrorType.ProviderBizError]: {
    code: AgentRuntimeErrorType.ProviderBizError,
    numericId: 8002,
    category: 'provider',
    severity: 'error',
    attribution: 'provider',
    httpStatus: 471,
    retryable: false,
    countAsFailure: true,
    description: 'Generic provider biz error (unclassified upstream failure).',
  },
  [AgentRuntimeErrorType.ProviderNoImageGenerated]: {
    code: AgentRuntimeErrorType.ProviderNoImageGenerated,
    numericId: 8003,
    category: 'provider',
    severity: 'warning',
    attribution: 'provider',
    httpStatus: 471,
    retryable: false,
    countAsFailure: true,
    description: 'Image-generation provider returned no image.',
  },
  [AgentRuntimeErrorType.OllamaBizError]: {
    code: AgentRuntimeErrorType.OllamaBizError,
    numericId: 8004,
    category: 'provider',
    severity: 'error',
    attribution: 'provider',
    httpStatus: 472,
    retryable: false,
    countAsFailure: true,
    description: 'Ollama returned a biz error.',
  },
  [AgentRuntimeErrorType.ComfyUIBizError]: {
    code: AgentRuntimeErrorType.ComfyUIBizError,
    numericId: 8005,
    category: 'provider',
    severity: 'error',
    attribution: 'provider',
    httpStatus: 472,
    retryable: false,
    countAsFailure: true,
    description: 'ComfyUI returned a biz error.',
  },
  [AgentRuntimeErrorType.ComfyUIEmptyResult]: {
    code: AgentRuntimeErrorType.ComfyUIEmptyResult,
    numericId: 8006,
    category: 'provider',
    severity: 'warning',
    attribution: 'provider',
    httpStatus: 472,
    retryable: false,
    countAsFailure: true,
    description: 'ComfyUI workflow ran but produced no output.',
  },
  [AgentRuntimeErrorType.ComfyUIUploadFailed]: {
    code: AgentRuntimeErrorType.ComfyUIUploadFailed,
    numericId: 8007,
    category: 'provider',
    severity: 'warning',
    attribution: 'user',
    httpStatus: 472,
    retryable: false,
    countAsFailure: false,
    description: 'ComfyUI input upload failed.',
  },
  [AgentRuntimeErrorType.ComfyUIWorkflowError]: {
    code: AgentRuntimeErrorType.ComfyUIWorkflowError,
    numericId: 8008,
    category: 'provider',
    severity: 'warning',
    attribution: 'user',
    httpStatus: 472,
    retryable: false,
    countAsFailure: false,
    description: 'ComfyUI workflow definition is invalid.',
  },
  [AgentRuntimeErrorType.ComfyUIModelError]: {
    code: AgentRuntimeErrorType.ComfyUIModelError,
    numericId: 8009,
    category: 'provider',
    severity: 'warning',
    attribution: 'user',
    httpStatus: 472,
    retryable: false,
    countAsFailure: false,
    description: 'ComfyUI model load / inference failed.',
  },

  // ─── 9xxx Config ──────────────────────────────────────────────────────
  [AgentRuntimeErrorType.InvalidOllamaArgs]: {
    code: AgentRuntimeErrorType.InvalidOllamaArgs,
    numericId: 9001,
    category: 'config',
    severity: 'warning',
    attribution: 'user',
    httpStatus: 400,
    retryable: false,
    countAsFailure: false,
    description: 'Ollama runtime arguments are invalid.',
  },
  [AgentRuntimeErrorType.InvalidComfyUIArgs]: {
    code: AgentRuntimeErrorType.InvalidComfyUIArgs,
    numericId: 9002,
    category: 'config',
    severity: 'warning',
    attribution: 'user',
    httpStatus: 400,
    retryable: false,
    countAsFailure: false,
    description: 'ComfyUI runtime arguments are invalid.',
  },
  [AgentRuntimeErrorType.UserConfigError]: {
    code: AgentRuntimeErrorType.UserConfigError,
    numericId: 9003,
    category: 'config',
    severity: 'warning',
    attribution: 'user',
    httpStatus: 400,
    retryable: false,
    countAsFailure: false,
    description:
      'User-side misconfiguration (bad base URL, missing env var, virtual-key allowlist).',
  },
  [AgentRuntimeErrorType.NoAvailableProvider]: {
    code: AgentRuntimeErrorType.NoAvailableProvider,
    numericId: 9004,
    category: 'config',
    severity: 'warning',
    attribution: 'user',
    httpStatus: 400,
    retryable: false,
    countAsFailure: false,
    description: 'No provider is configured / enabled for the requested model.',
  },
  [AgentRuntimeErrorType.ConnectionCheckFailed]: {
    code: AgentRuntimeErrorType.ConnectionCheckFailed,
    numericId: 9005,
    category: 'config',
    severity: 'warning',
    attribution: 'user',
    httpStatus: 400,
    retryable: false,
    countAsFailure: false,
    description: 'Provider connection check failed during setup.',
  },
};

/**
 * Aliases from deprecated string codes to their canonical replacements. Lets
 * `getErrorCodeSpec('QuotaLimitReached')` still resolve to the spec for
 * `RateLimitExceeded` so older callers and stored error records keep working.
 */
const CODE_ALIASES: Record<string, ILobeAgentRuntimeErrorType> = {
  [AgentRuntimeErrorType.QuotaLimitReached]: AgentRuntimeErrorType.RateLimitExceeded,
};

/** Look up the spec for an error code; falls back to `undefined` when unknown. */
export const getErrorCodeSpec = (
  code: ILobeAgentRuntimeErrorType | string | undefined,
): ErrorCodeSpec | undefined => {
  if (!code) return undefined;
  const canonical = CODE_ALIASES[code] ?? code;
  return ERROR_CODE_SPECS[canonical as ILobeAgentRuntimeErrorType];
};

/**
 * Format an error code as its stable numeric reference, e.g. `E1001`.
 * Returns `undefined` for codes that are not in the spec table.
 *
 * Use this when surfacing the error in places that need a stable, language-
 * independent identifier — support tickets, public docs anchors, external SDK
 * error mapping, etc.
 */
export const formatErrorRef = (
  code: ILobeAgentRuntimeErrorType | string | undefined,
): string | undefined => {
  const spec = getErrorCodeSpec(code);
  if (!spec) return undefined;
  return `E${spec.numericId}`;
};

const ERROR_REF_PATTERN = /^E(\d{4})$/;

/**
 * Inverse of `formatErrorRef`: parse `E1001` back into the matching error
 * code. Returns `undefined` if the ref doesn't correspond to a known spec.
 */
export const parseErrorRef = (ref: string | undefined): ILobeAgentRuntimeErrorType | undefined => {
  if (!ref) return undefined;
  const match = ERROR_REF_PATTERN.exec(ref);
  if (!match) return undefined;
  const id = Number.parseInt(match[1], 10);
  for (const spec of Object.values(ERROR_CODE_SPECS)) {
    if (spec?.numericId === id) return spec.code;
  }
  return undefined;
};

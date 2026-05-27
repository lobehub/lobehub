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
  // ─── Auth / Credentials ─────────────────────────────────────────────────────
  [AgentRuntimeErrorType.InvalidProviderAPIKey]: {
    code: AgentRuntimeErrorType.InvalidProviderAPIKey,
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
    category: 'auth',
    severity: 'warning',
    attribution: 'user',
    httpStatus: 401,
    retryable: false,
    countAsFailure: false,
    description: 'Google Vertex credentials are invalid or service-account misconfigured.',
  },
  [AgentRuntimeErrorType.InvalidOllamaArgs]: {
    code: AgentRuntimeErrorType.InvalidOllamaArgs,
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
    category: 'config',
    severity: 'warning',
    attribution: 'user',
    httpStatus: 400,
    retryable: false,
    countAsFailure: false,
    description: 'ComfyUI runtime arguments are invalid.',
  },
  [AgentRuntimeErrorType.PermissionDenied]: {
    code: AgentRuntimeErrorType.PermissionDenied,
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
    category: 'auth',
    severity: 'warning',
    attribution: 'user',
    httpStatus: 403,
    retryable: false,
    countAsFailure: false,
    description: 'Provider unavailable from the caller geographic region.',
  },

  // ─── Quota / Billing ────────────────────────────────────────────────────────
  [AgentRuntimeErrorType.InsufficientQuota]: {
    code: AgentRuntimeErrorType.InsufficientQuota,
    category: 'quota',
    severity: 'warning',
    attribution: 'user',
    httpStatus: 429,
    retryable: false,
    countAsFailure: false,
    description: 'Account balance or billing quota exhausted.',
  },
  [AgentRuntimeErrorType.QuotaLimitReached]: {
    code: AgentRuntimeErrorType.QuotaLimitReached,
    category: 'capacity',
    severity: 'warning',
    attribution: 'provider',
    httpStatus: 429,
    retryable: true,
    countAsFailure: false,
    description: 'Short-window rate limit (RPM / TPM / concurrency) reached.',
  },

  // ─── Capacity ───────────────────────────────────────────────────────────────
  [AgentRuntimeErrorType.ProviderServiceUnavailable]: {
    code: AgentRuntimeErrorType.ProviderServiceUnavailable,
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
    category: 'capacity',
    severity: 'warning',
    attribution: 'provider',
    httpStatus: 503,
    retryable: false,
    countAsFailure: false,
    description: 'Proxy / router has no available channel or key for the model.',
  },
  [AgentRuntimeErrorType.ProviderNetworkError]: {
    code: AgentRuntimeErrorType.ProviderNetworkError,
    category: 'network',
    severity: 'warning',
    attribution: 'system',
    httpStatus: 504,
    retryable: true,
    countAsFailure: false,
    description: 'Connection timeout / network drop talking to the provider.',
  },

  // ─── Request / Model ────────────────────────────────────────────────────────
  [AgentRuntimeErrorType.ModelNotFound]: {
    code: AgentRuntimeErrorType.ModelNotFound,
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
    category: 'request',
    severity: 'warning',
    attribution: 'user',
    httpStatus: 400,
    retryable: false,
    countAsFailure: false,
    description: 'Upstream rejected the request as malformed (bad JSON / schema / parameters).',
  },

  // ─── Safety ─────────────────────────────────────────────────────────────────
  [AgentRuntimeErrorType.ContentModeration]: {
    code: AgentRuntimeErrorType.ContentModeration,
    category: 'safety',
    severity: 'info',
    attribution: 'user',
    httpStatus: 451,
    retryable: false,
    countAsFailure: false,
    description: 'Upstream content-safety filter rejected the input or output.',
  },

  // ─── Config ─────────────────────────────────────────────────────────────────
  [AgentRuntimeErrorType.UserConfigError]: {
    code: AgentRuntimeErrorType.UserConfigError,
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
    category: 'config',
    severity: 'warning',
    attribution: 'user',
    httpStatus: 400,
    retryable: false,
    countAsFailure: false,
    description: 'Provider connection check failed during setup.',
  },

  // ─── Stream / Runtime ───────────────────────────────────────────────────────
  [AgentRuntimeErrorType.StreamChunkError]: {
    code: AgentRuntimeErrorType.StreamChunkError,
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
    category: 'stream',
    severity: 'error',
    attribution: 'harness',
    httpStatus: 500,
    retryable: false,
    countAsFailure: true,
    description: 'Conversation chain broken because an assistant/tool message lost its parent.',
  },

  // ─── Provider (catch-all) ───────────────────────────────────────────────────
  [AgentRuntimeErrorType.AgentRuntimeError]: {
    code: AgentRuntimeErrorType.AgentRuntimeError,
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
    category: 'provider',
    severity: 'warning',
    attribution: 'provider',
    httpStatus: 471,
    retryable: false,
    countAsFailure: true,
    description: 'Image-generation provider returned no image.',
  },

  // ─── Ollama ─────────────────────────────────────────────────────────────────
  [AgentRuntimeErrorType.OllamaServiceUnavailable]: {
    code: AgentRuntimeErrorType.OllamaServiceUnavailable,
    category: 'capacity',
    severity: 'warning',
    attribution: 'user',
    httpStatus: 472,
    retryable: false,
    countAsFailure: false,
    description: 'Local Ollama service is not reachable.',
  },
  [AgentRuntimeErrorType.OllamaBizError]: {
    code: AgentRuntimeErrorType.OllamaBizError,
    category: 'provider',
    severity: 'error',
    attribution: 'provider',
    httpStatus: 472,
    retryable: false,
    countAsFailure: true,
    description: 'Ollama returned a biz error.',
  },

  // ─── ComfyUI ────────────────────────────────────────────────────────────────
  [AgentRuntimeErrorType.ComfyUIServiceUnavailable]: {
    code: AgentRuntimeErrorType.ComfyUIServiceUnavailable,
    category: 'capacity',
    severity: 'warning',
    attribution: 'user',
    httpStatus: 472,
    retryable: false,
    countAsFailure: false,
    description: 'Local ComfyUI service is not reachable.',
  },
  [AgentRuntimeErrorType.ComfyUIBizError]: {
    code: AgentRuntimeErrorType.ComfyUIBizError,
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
    category: 'provider',
    severity: 'warning',
    attribution: 'user',
    httpStatus: 472,
    retryable: false,
    countAsFailure: false,
    description: 'ComfyUI model load / inference failed.',
  },
};

/** Look up the spec for an error code; falls back to `undefined` when unknown. */
export const getErrorCodeSpec = (
  code: ILobeAgentRuntimeErrorType | string | undefined,
): ErrorCodeSpec | undefined => {
  if (!code) return undefined;
  return ERROR_CODE_SPECS[code as ILobeAgentRuntimeErrorType];
};

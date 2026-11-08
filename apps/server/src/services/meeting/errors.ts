import type { MeetingErrorCode } from '@lobechat/types';
import { AgentRuntimeErrorType } from '@lobechat/types';

const NOT_CONFIGURED = new Set<string>([
  AgentRuntimeErrorType.InvalidBedrockCredentials,
  AgentRuntimeErrorType.InvalidProviderAPIKey,
  AgentRuntimeErrorType.InvalidVertexCredentials,
  AgentRuntimeErrorType.ModelNotFound,
  AgentRuntimeErrorType.NoAvailableProvider,
  AgentRuntimeErrorType.NoOpenAIAPIKey,
  AgentRuntimeErrorType.PermissionDenied,
  AgentRuntimeErrorType.UserConfigError,
]);

const QUOTA = new Set<string>([
  AgentRuntimeErrorType.InsufficientQuota,
  AgentRuntimeErrorType.QuotaLimitReached,
]);

const UNAVAILABLE = new Set<string>([
  AgentRuntimeErrorType.ProviderNetworkError,
  AgentRuntimeErrorType.ProviderServiceUnavailable,
  AgentRuntimeErrorType.RateLimitExceeded,
  AgentRuntimeErrorType.UpstreamGatewayError,
  AgentRuntimeErrorType.UpstreamHttpError,
]);

/** Raised for failures that come from the recording itself rather than the provider. */
export class MeetingTranscriptionError extends Error {
  constructor(
    readonly code: MeetingErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'MeetingTranscriptionError';
  }
}

const readErrorType = (error: unknown): string | undefined => {
  if (!error || typeof error !== 'object') return undefined;
  const { errorType } = error as { errorType?: unknown };
  return typeof errorType === 'string' ? errorType : undefined;
};

/**
 * Turn a transcription or minutes failure into the code the meeting UI acts on. Provider
 * errors arrive as runtime payloads (`{ errorType, error }`); billing gates of
 * hosted deployments name budgets or quotas in their type.
 */
export const toMeetingErrorCode = (
  error: unknown,
  fallback: MeetingErrorCode = 'transcription_failed',
): MeetingErrorCode => {
  if (error instanceof MeetingTranscriptionError) return error.code;

  const errorType = readErrorType(error);
  if (errorType) {
    if (NOT_CONFIGURED.has(errorType)) return 'provider_not_configured';
    if (QUOTA.has(errorType) || /budget|quota|credit/i.test(errorType)) return 'quota_exceeded';
    if (UNAVAILABLE.has(errorType)) return 'provider_unavailable';
  }

  return fallback;
};

/** Short detail kept next to the code for support; never contains credentials. */
export const toMeetingErrorMessage = (error: unknown): string | undefined => {
  if (error instanceof Error) return error.message.slice(0, 500);

  const errorType = readErrorType(error);
  const inner = (error as { error?: { message?: unknown } } | undefined)?.error?.message;
  const detail = typeof inner === 'string' ? inner : undefined;
  const message = [errorType, detail].filter(Boolean).join(': ');
  return message ? message.slice(0, 500) : undefined;
};

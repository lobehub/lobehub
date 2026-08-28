import { AUTH_REQUIRED_HEADER } from '@lobechat/desktop-bridge';
import { getErrorCodeSpec } from '@lobechat/model-runtime/errors';
import type { ILobeAgentRuntimeErrorType } from '@lobechat/model-runtime/types/error';
import type { ErrorResponse, ErrorType } from '@lobechat/types';
import { ChatErrorType } from '@lobechat/types';

/**
 * Error types that indicate a real authentication failure.
 * When these errors occur, the response will include X-Auth-Required header
 * to signal the client that re-authentication is needed.
 */
const AUTH_REQUIRED_ERROR_TYPES = new Set<ErrorType>([ChatErrorType.Unauthorized]);

/**
 * Resolves canonical runtime specs before app-only fallbacks so codes such as
 * InvalidRequestFormat keep their declared 400 instead of the legacy Invalid* 401.
 */
const getStatus = (errorType: ILobeAgentRuntimeErrorType | ErrorType) => {
  const spec = getErrorCodeSpec(typeof errorType === 'string' ? errorType : undefined);
  if (spec) return spec.httpStatus;

  // InvalidAccessCode / InvalidAzureAPIKey / InvalidOpenAIAPIKey / InvalidZhipuAPIKey ....
  if (errorType.toString().includes('Invalid')) return 401;

  switch (errorType) {
    case ChatErrorType.NoOpenAIAPIKey: {
      return 401;
    }

    case ChatErrorType.SubscriptionPlanLimit:
    case ChatErrorType.WorkspaceFrozenByAdmin:
    case ChatErrorType.WorkspaceFrozenByRiskControl:
    case ChatErrorType.WorkspaceSubscriptionInactive: {
      return 403;
    }

    case ChatErrorType.SystemTimeNotMatchError: {
      return 400;
    }
  }

  return typeof errorType === 'number' ? errorType : undefined;
};

export const createErrorResponse = (
  errorType: ErrorType | ILobeAgentRuntimeErrorType,
  body?: any,
) => {
  const resolvedStatusCode = getStatus(errorType);
  const isValidStatusCode =
    typeof resolvedStatusCode === 'number' &&
    resolvedStatusCode >= 200 &&
    resolvedStatusCode <= 599;
  const statusCode = isValidStatusCode ? resolvedStatusCode : 500;

  const data: ErrorResponse = { body, errorType };

  if (!isValidStatusCode) {
    console.error(
      `Unknown error type: \`${errorType}\`.`,
      'Falling back to HTTP 500. Define the status in the shared error code specs or app mapping.',
    );
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  // Add X-Auth-Required header for real authentication failures
  // This allows the client to distinguish between auth failures and other 401 errors (e.g., invalid API keys)
  if (AUTH_REQUIRED_ERROR_TYPES.has(errorType as ErrorType)) {
    headers[AUTH_REQUIRED_HEADER] = 'true';
  }

  return new Response(JSON.stringify(data), { headers, status: statusCode });
};

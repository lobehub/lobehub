import { AgentRuntimeErrorType, ILobeAgentRuntimeErrorType } from '../types/error';

export interface ComfyUIError {
  code?: number | string;
  details?: any;
  message: string;
  missingFileName?: string;
  missingFileType?: 'model' | 'component';
  status?: number;
  type?: string;
  userGuidance?: string;
}

export interface ParsedError {
  error: ComfyUIError;
  errorType: ILobeAgentRuntimeErrorType;
}

/**
 * Clean ComfyUI error message by removing formatting characters and extra spaces
 * @param message - Original error message
 * @returns Cleaned error message
 */
export function cleanComfyUIErrorMessage(message: string): string {
  return message
    .replaceAll(/^\*\s*/gm, '') // Remove leading asterisks and spaces (multiline)
    .replaceAll('\\n', '\n') // Convert escaped newlines
    .replaceAll(/\n+/g, ' ') // Replace multiple newlines with single space
    .trim(); // Remove leading and trailing spaces
}

/**
 * Extract structured information from error object
 * Client-side version that preserves server-generated information
 * @param error - Original error object
 * @returns Structured ComfyUI error information
 */
function extractComfyUIErrorInfo(error: any): ComfyUIError {
  // Handle string errors
  if (typeof error === 'string') {
    const cleanedMessage = cleanComfyUIErrorMessage(error);

    return {
      message: cleanedMessage,
    };
  }

  // Handle Error objects - prioritize cause field (SDK pattern)
  if (error instanceof Error) {
    // Check if there's a cause field with actual error details (SDK pattern)
    if ((error as any).cause) {
      const cause = (error as any).cause;
      // Recursively extract error info from cause
      const causeInfo = extractComfyUIErrorInfo(cause);
      return {
        ...causeInfo,
        // Preserve the original error type if cause doesn't have one
        type: causeInfo.type || error.name,
      };
    }

    const cleanedMessage = cleanComfyUIErrorMessage(error.message);

    return {
      code: (error as any).code,
      message: cleanedMessage,
      // Preserve server-generated file info and guidance
      missingFileName: (error as any).missingFileName,
      missingFileType: (error as any).missingFileType,
      status: (error as any).status || (error as any).statusCode,
      type: error.name,
      userGuidance: (error as any).userGuidance,
    };
  }

  // Handle structured objects
  if (error && typeof error === 'object') {
    // Check for cause field first (SDK pattern)
    if (error.cause) {
      const causeInfo = extractComfyUIErrorInfo(error.cause);
      return {
        ...causeInfo,
        type: causeInfo.type || error.type || error.name || error.constructor?.name,
      };
    }

    // Extract message from various possible sources
    const possibleMessage = [
      error.exception_message, // ComfyUI specific field (highest priority)
      error.error?.exception_message, // Nested ComfyUI exception message
      error.error?.error, // Deeply nested error.error.error path
      error.message,
      error.error?.message,
      error.data?.message,
      error.body?.message,
      error.body?.error?.message,
      error.response?.data?.message,
      error.response?.data?.error?.message,
      error.response?.text,
      error.response?.body,
      error.statusText,
    ].find(Boolean);

    const message = possibleMessage || String(error);

    // Extract status code from various possible locations
    const possibleStatus = [
      error.status,
      error.statusCode,
      error.details?.status, // ServicesError puts status in details
      error.response?.status,
      error.response?.statusCode,
      error.error?.status,
      error.error?.statusCode,
    ].find(Number.isInteger);

    const code = error.code || error.error?.code || error.response?.data?.code;

    // Extract details including ComfyUI specific fields
    let details = error.response?.data || error.details || undefined;

    // Include ComfyUI specific fields in details
    if (error.node_id || error.node_type || error.nodeId || error.nodeType || error.nodeName) {
      details = {
        ...details,
        nodeName: error.nodeName,
        node_id: error.node_id || error.nodeId,
        node_type: error.node_type || error.nodeType,
      };
    }

    const cleanedMessage = cleanComfyUIErrorMessage(message);

    // Extract server-provided file info and guidance from various locations
    const missingFileName =
      error.missingFileName || error.body?.error?.missingFileName || error.error?.missingFileName;

    const missingFileType =
      error.missingFileType || error.body?.error?.missingFileType || error.error?.missingFileType;

    const userGuidance =
      error.userGuidance || error.body?.error?.userGuidance || error.error?.userGuidance;

    return {
      code,
      details,
      message: cleanedMessage,
      missingFileName,
      missingFileType,
      status: possibleStatus,
      type: error.type || error.name || error.constructor?.name,
      userGuidance,
    };
  }

  // Fallback handling
  const cleanedMessage = cleanComfyUIErrorMessage(String(error));

  return {
    message: cleanedMessage,
  };
}

/**
 * Parse ComfyUI error message and return structured error information
 * Client-side version that focuses on error type categorization
 * File information and userGuidance are expected from server-side error handling
 * @param error - Original error object
 * @returns Parsed error object and error type
 */
export function parseComfyUIErrorMessage(error: any): ParsedError {
  // Check if it's already an AgentRuntimeError from WebAPI
  // AgentRuntimeError has structure: { error: object, errorType: string, provider: string }
  if (
    error &&
    typeof error === 'object' &&
    'errorType' in error &&
    'error' in error &&
    'provider' in error
  ) {
    // Already parsed by server, return as-is
    return {
      error: error.error,
      errorType: error.errorType,
    };
  }

  // Check if it's an error from checkAuth middleware
  // Format: { body: any, errorType: string }
  if (error && typeof error === 'object' && 'errorType' in error && 'body' in error) {
    // Extract error message from body
    let message = 'Authentication failed';
    if (error.body?.error?.message) {
      message = error.body.error.message;
    } else if (error.body?.error && typeof error.body.error === 'string') {
      message = error.body.error;
    } else if (error.body?.message) {
      message = error.body.message;
    }

    return {
      error: {
        message,
        status: 401,
      },
      errorType: AgentRuntimeErrorType.InvalidProviderAPIKey,
    };
  }

  const errorInfo = extractComfyUIErrorInfo(error);

  // Default error type
  let errorType: ILobeAgentRuntimeErrorType = AgentRuntimeErrorType.ComfyUIBizError;

  // Note: SyntaxError checking moved to server-side errorHandlerService
  // Client-side will never receive raw SyntaxError as it's already processed by server

  // 1. HTTP status code errors (priority check)
  const status = errorInfo.status;
  const message = errorInfo.message;

  switch (status) {
    case 400:
    case 401: {
      // These trigger ComfyUIAuth component
      errorType = AgentRuntimeErrorType.InvalidProviderAPIKey;
      break;
    }
    case 403: {
      // Permission denied
      errorType = AgentRuntimeErrorType.PermissionDenied;
      break;
    }
    case 404: {
      // 404 should trigger ComfyUIAuth for baseURL errors
      errorType = AgentRuntimeErrorType.InvalidProviderAPIKey;
      break;
    }
    default: {
      if (status && status >= 500) {
        // Server errors
        errorType = AgentRuntimeErrorType.ComfyUIServiceUnavailable;
      }
      // 2. Check HTTP status code from error message (when status field doesn't exist)
      else if (!status && message) {
        if (message.includes('HTTP 401') || message.includes('401')) {
          errorType = AgentRuntimeErrorType.InvalidProviderAPIKey;
        } else if (message.includes('HTTP 403') || message.includes('403')) {
          errorType = AgentRuntimeErrorType.PermissionDenied;
        } else if (message.includes('HTTP 404') || message.includes('404')) {
          errorType = AgentRuntimeErrorType.InvalidProviderAPIKey;
        } else if (message.includes('HTTP 400') || message.includes('400')) {
          errorType = AgentRuntimeErrorType.InvalidProviderAPIKey;
        }
      }
    }
  }

  // Note: Error type determination is done server-side
  // Client receives pre-determined errorType from server

  return {
    error: errorInfo,
    errorType,
  };
}

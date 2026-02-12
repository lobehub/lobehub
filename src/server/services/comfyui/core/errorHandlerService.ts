/**
 * Error Handler Service
 *
 * Centralized error handling for ComfyUI runtime
 * Maps internal errors to framework errors
 */
import { type ILobeAgentRuntimeErrorType } from '@lobechat/model-runtime';
import { AgentRuntimeError, AgentRuntimeErrorType } from '@lobechat/model-runtime';
import { TRPCError } from '@trpc/server';

import { SYSTEM_COMPONENTS } from '@/server/services/comfyui/config/systemComponents';
import {
  ConfigError,
  isComfyUIInternalError,
  ServicesError,
  UtilsError,
  WorkflowError,
} from '@/server/services/comfyui/errors';
import { ModelResolverError } from '@/server/services/comfyui/errors/modelResolverError';
import { getComponentInfo } from '@/server/services/comfyui/utils/componentInfo';

interface ComfyUIError {
  code?: number | string;
  details?: any;
  message: string;
  missingFileName?: string;
  missingFileType?: 'model' | 'component';
  status?: number;
  type?: string;
  userGuidance?: string;
}

interface ParsedError {
  error: ComfyUIError;
  errorType: ILobeAgentRuntimeErrorType;
}

/**
 * Generate user guidance message based on missing file info
 * Server-side version with access to full component information
 * @param fileName - The missing file name
 * @param fileType - The type of missing file
 * @returns User-friendly guidance message
 */
function generateUserGuidance(fileName: string, fileType: 'model' | 'component'): string {
  if (fileType === 'component') {
    const componentInfo = getComponentInfo(fileName);

    if (componentInfo) {
      return `Missing ${componentInfo.displayName}: ${fileName}. Please download and place it in the ${componentInfo.folderPath} folder.`;
    }

    // Fallback for unknown components
    return `Missing component file: ${fileName}. Please download and place it in the appropriate ComfyUI models folder.`;
  }

  // Main model files
  return `Missing model file: ${fileName}. Please download and place it in the models/checkpoints folder.`;
}

/**
 * Extract missing file information from error message
 * Server-side version with access to SYSTEM_COMPONENTS
 * @param message - Error message that may contain file names
 * @returns Object with extracted file name and type, or null if no file found
 */
function extractMissingFileInfo(message: string): {
  fileName: string;
  fileType: 'model' | 'component';
} | null {
  if (!message) return null;

  // Check for "Expected one of:" pattern from enhanced model errors
  const expectedPattern = /expected one of:\s*([^.]+\.(?:safetensors|ckpt|pt|pth))/i;
  const expectedMatch = message.match(expectedPattern);

  if (expectedMatch) {
    // Extract the first file from the match
    const fileName = expectedMatch[1].trim().split(',')[0].trim();
    if (fileName) {
      return {
        fileName,
        fileType: 'model',
      };
    }
  }

  // Common model file extensions - allow dots in filename
  const modelFilePattern = /([\w.-]+\.(?:safetensors|ckpt|pt|pth))\b/gi;
  const fileMatch = message.match(modelFilePattern);

  if (fileMatch) {
    const fileName = fileMatch[0];

    // Use server-side SYSTEM_COMPONENTS to check if it's a system component
    if (fileName in SYSTEM_COMPONENTS) {
      return {
        fileName,
        fileType: 'component',
      };
    }

    // If not found in SYSTEM_COMPONENTS, treat as main model
    return {
      fileName,
      fileType: 'model',
    };
  }

  return null;
}

/**
 * Check if the error is a model-related error
 * @param error - Error object
 * @param message - Pre-extracted message
 * @returns Whether it's a model error
 */
function isModelError(error: any, message?: string): boolean {
  const errorMessage = message || error?.message || String(error);
  const lowerMessage = errorMessage.toLowerCase();

  // Check for explicit model error patterns
  const hasModelErrorPattern =
    lowerMessage.includes('model not found') ||
    lowerMessage.includes('checkpoint not found') ||
    lowerMessage.includes('model file not found') ||
    lowerMessage.includes('ckpt_name') ||
    lowerMessage.includes('no models available') ||
    lowerMessage.includes('safetensors') ||
    lowerMessage.includes('.ckpt') ||
    lowerMessage.includes('.pt') ||
    lowerMessage.includes('.pth') ||
    error?.code === 'MODEL_NOT_FOUND';

  // Also check if the error contains a model file that's missing
  if (!hasModelErrorPattern) {
    const fileInfo = extractMissingFileInfo(errorMessage);
    return fileInfo !== null; // Any missing model file is considered a model error
  }

  return hasModelErrorPattern;
}

/**
 * Check if the error is a ComfyUI SDK custom error
 * @param error - Error object
 * @returns Whether it's a SDK custom error
 */
function isSDKCustomError(error: any): boolean {
  if (!error) return false;

  // Check for SDK error class names
  const errorName = error?.name || error?.constructor?.name || '';
  const sdkErrorTypes = [
    // Base error class
    'CallWrapperError',
    // Actual SDK error classes from comfyui-sdk
    'WentMissingError',
    'FailedCacheError',
    'EnqueueFailedError',
    'DisconnectedError',
    'ExecutionFailedError',
    'CustomEventError',
    'ExecutionInterruptedError',
    'MissingNodeError',
  ];

  if (sdkErrorTypes.includes(errorName)) {
    return true;
  }

  // Check for SDK error messages patterns
  const message = error?.message || String(error);
  const lowerMessage = message.toLowerCase();

  return (
    lowerMessage.includes('sdk error:') ||
    lowerMessage.includes('call wrapper') ||
    lowerMessage.includes('execution interrupted') ||
    lowerMessage.includes('missing node type') ||
    lowerMessage.includes('invalid model configuration') ||
    lowerMessage.includes('workflow validation failed') ||
    lowerMessage.includes('sdk timeout') ||
    lowerMessage.includes('sdk configuration error')
  );
}

/**
 * Check if the error is a network connection error (including WebSocket)
 * @param error - Error object
 * @param message - Pre-extracted message
 * @param code - Pre-extracted code
 * @returns Whether it's a network connection error
 */
function isNetworkError(error: any, message?: string, code?: string | number): boolean {
  const errorMessage = message || error?.message || String(error);
  const lowerMessage = errorMessage.toLowerCase();
  const errorCode = code || error?.code;

  return (
    // Basic network errors
    errorMessage === 'fetch failed' ||
    lowerMessage.includes('econnrefused') ||
    lowerMessage.includes('enotfound') ||
    lowerMessage.includes('etimedout') ||
    lowerMessage.includes('network error') ||
    lowerMessage.includes('connection refused') ||
    lowerMessage.includes('connection timeout') ||
    errorCode === 'ECONNREFUSED' ||
    errorCode === 'ENOTFOUND' ||
    errorCode === 'ETIMEDOUT' ||
    // WebSocket specific errors
    lowerMessage.includes('websocket') ||
    lowerMessage.includes('ws connection') ||
    lowerMessage.includes('connection lost to comfyui server') ||
    errorCode === 'WS_CONNECTION_FAILED' ||
    errorCode === 'WS_TIMEOUT' ||
    errorCode === 'WS_HANDSHAKE_FAILED'
  );
}

/**
 * Check if the error is a ComfyUI workflow error
 * @param error - Error object
 * @param message - Pre-extracted message
 * @returns Whether it's a workflow error
 */
function isWorkflowError(error: any, message?: string): boolean {
  const errorMessage = message || error?.message || String(error);
  const lowerMessage = errorMessage.toLowerCase();

  // Check for structured workflow error fields
  if (
    error &&
    typeof error === 'object' &&
    (error.node_id || error.nodeId || error.node_type || error.nodeType)
  ) {
    return true;
  }

  return (
    lowerMessage.includes('node') ||
    lowerMessage.includes('workflow') ||
    lowerMessage.includes('execution') ||
    lowerMessage.includes('prompt') ||
    lowerMessage.includes('queue') ||
    lowerMessage.includes('invalid input') ||
    lowerMessage.includes('missing required') ||
    lowerMessage.includes('node execution failed') ||
    lowerMessage.includes('workflow validation') ||
    error?.type === 'workflow_error'
  );
}

/**
 * Simple ComfyUI error parser
 * Extracts error information and determines error type
 */
function parseComfyUIErrorMessage(error: any): ParsedError {
  // Default error info
  let message = 'Unknown error';
  let status: number | undefined;
  let code: string | undefined;
  let missingFileName: string | undefined;
  let missingFileType: 'model' | 'component' | undefined;
  let userGuidance: string | undefined;
  let errorType: ILobeAgentRuntimeErrorType = AgentRuntimeErrorType.ComfyUIBizError;

  // Check for JSON parsing errors (indicates non-ComfyUI service)
  if (
    error instanceof SyntaxError ||
    (error && typeof error === 'object' && error.name === 'SyntaxError')
  ) {
    const syntaxMessage = error?.message || String(error);
    if (syntaxMessage.includes('JSON') || syntaxMessage.includes('Unexpected token')) {
      // JSON parsing failed - service is not ComfyUI
      return {
        error: {
          message: 'Service is not ComfyUI - received non-JSON response',
          type: 'SyntaxError',
          userGuidance:
            'The service at this URL is not a ComfyUI server. Please check your baseURL configuration.',
        },
        errorType: AgentRuntimeErrorType.InvalidProviderAPIKey, // Trigger auth dialog
      };
    }
  }

  // Extract message
  if (typeof error === 'string') {
    message = error;
  } else if (error instanceof Error) {
    message = error.message;
    code = (error as any).code;
  } else if (error && typeof error === 'object') {
    // Extract message from various possible sources (matching original logic)
    const possibleMessage = [
      error.exception_message, // ComfyUI specific field (highest priority)
      error.error?.exception_message, // Nested ComfyUI exception message
      error.error?.error, // Deeply nested error.error.error path
      error.message,
      error.error?.message,
      error.data?.message,
      error.body?.message,
      error.response?.data?.message,
      error.response?.data?.error?.message,
      error.response?.text,
      error.response?.body,
      error.statusText,
    ].find(Boolean);

    // Use the message or fallback to a generic error
    if (!possibleMessage) {
      message = 'Unknown error occurred';
    } else {
      message = possibleMessage;
    }

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

    status = possibleStatus;
    code = error.code || error.error?.code || error.response?.data?.code;
  }

  // Extract missing file information and generate guidance
  const fileInfo = extractMissingFileInfo(message);
  if (fileInfo) {
    missingFileName = fileInfo.fileName;
    missingFileType = fileInfo.fileType;
    userGuidance = generateUserGuidance(fileInfo.fileName, fileInfo.fileType);
  }

  // Determine error type based on status code
  if (status) {
    switch (status) {
      case 400:
      case 401:
      case 404: {
        errorType = AgentRuntimeErrorType.InvalidProviderAPIKey;
        break;
      }
      case 403: {
        errorType = AgentRuntimeErrorType.PermissionDenied;
        break;
      }
      default: {
        if (status >= 500) {
          errorType = AgentRuntimeErrorType.ComfyUIServiceUnavailable;
        }
      }
    }
  }

  // Check for more specific error types only if it's still a generic ComfyUIBizError
  if (errorType === AgentRuntimeErrorType.ComfyUIBizError) {
    if (isSDKCustomError(error)) {
      // SDK errors remain as ComfyUIBizError
      errorType = AgentRuntimeErrorType.ComfyUIBizError;
    } else if (isNetworkError(error, message, code)) {
      errorType = AgentRuntimeErrorType.ComfyUIServiceUnavailable;
    } else if (isWorkflowError(error, message)) {
      errorType = AgentRuntimeErrorType.ComfyUIWorkflowError;
    } else if (isModelError(error, message)) {
      errorType = AgentRuntimeErrorType.ModelNotFound;
    }
  }

  const result = {
    error: {
      code,
      message,
      missingFileName,
      missingFileType,
      status,
      type: error?.name || error?.type,
      userGuidance,
    },
    errorType,
  };

  return result;
}

/**
 * Error Handler Service
 * Provides unified error handling and transformation
 */
export class ErrorHandlerService {
  /**
   * Handle and transform any error into framework error
   * Enhanced to preserve more debugging information while maintaining compatibility
   * @param error - The error to handle
   * @throws {TRPCError} Always throws a properly formatted error with cause
   */
  handleError(error: unknown): never {
    // 1. If already a framework error, wrap in TRPCError
    if (error && typeof error === 'object' && 'errorType' in error) {
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'ComfyUI service error',
      });
    }

    // 2. Handle ComfyUI internal errors - enhance information preservation
    if (isComfyUIInternalError(error)) {
      const errorType = this.mapInternalErrorToRuntimeError(error);

      // Enhanced: preserve more context information
      const enhancedError = {
        details: error.details || {},
        message: error.message,
        // Preserve original error type and reason
        originalErrorType: error.constructor.name,
        originalReason: error.reason,
        // Note: Removed originalError to avoid serialization issues
      };

      const agentError = AgentRuntimeError.createImage({
        error: enhancedError,
        errorType: errorType as ILobeAgentRuntimeErrorType,
        provider: 'comfyui',
      });

      throw new TRPCError({
        cause: agentError,
        code: 'INTERNAL_SERVER_ERROR',
        message: error.message,
      });
    }

    // 3. Parse other errors - use enhanced parser with more information
    const { error: parsedError, errorType } = parseComfyUIErrorMessage(error);

    // Enhanced: add more context
    const enhancedParsedError = {
      ...parsedError,
      // Add timestamp for debugging
      timestamp: new Date().toISOString(),
      // Note: Removed originalError to avoid serialization issues
    };

    const agentError = AgentRuntimeError.createImage({
      error: enhancedParsedError,
      errorType,
      provider: 'comfyui',
    });

    throw new TRPCError({
      cause: agentError,
      code: 'INTERNAL_SERVER_ERROR',
      message: parsedError.message || 'ComfyUI service error',
    });
  }

  /**
   * Map internal ComfyUI errors to runtime error types
   */
  private mapInternalErrorToRuntimeError(
    error: ConfigError | WorkflowError | UtilsError | ServicesError | ModelResolverError,
  ): string {
    if (error instanceof ConfigError) {
      const mapping: Record<string, string> = {
        [ConfigError.Reasons.INVALID_CONFIG]: AgentRuntimeErrorType.ComfyUIBizError,
        [ConfigError.Reasons.MISSING_CONFIG]: AgentRuntimeErrorType.ComfyUIBizError,
        [ConfigError.Reasons.CONFIG_PARSE_ERROR]: AgentRuntimeErrorType.ComfyUIBizError,
        [ConfigError.Reasons.REGISTRY_ERROR]: AgentRuntimeErrorType.ComfyUIBizError,
      };
      return mapping[error.reason] || AgentRuntimeErrorType.ComfyUIBizError;
    }

    if (error instanceof WorkflowError) {
      const mapping: Record<string, string> = {
        [WorkflowError.Reasons.INVALID_CONFIG]: AgentRuntimeErrorType.ComfyUIWorkflowError,
        [WorkflowError.Reasons.MISSING_COMPONENT]: AgentRuntimeErrorType.ComfyUIModelError,
        [WorkflowError.Reasons.MISSING_ENCODER]: AgentRuntimeErrorType.ComfyUIModelError,
        [WorkflowError.Reasons.UNSUPPORTED_MODEL]: AgentRuntimeErrorType.ModelNotFound,
        [WorkflowError.Reasons.INVALID_PARAMS]: AgentRuntimeErrorType.ComfyUIWorkflowError,
      };
      return mapping[error.reason] || AgentRuntimeErrorType.ComfyUIWorkflowError;
    }

    if (error instanceof ServicesError) {
      // If error already has parsed errorType in details, use it directly
      if (error.details?.errorType) {
        return error.details.errorType;
      }

      // Otherwise use mapping table
      const mapping: Record<string, string> = {
        [ServicesError.Reasons.INVALID_ARGS]: AgentRuntimeErrorType.InvalidComfyUIArgs,
        [ServicesError.Reasons.INVALID_AUTH]: AgentRuntimeErrorType.InvalidProviderAPIKey,
        [ServicesError.Reasons.INVALID_CONFIG]: AgentRuntimeErrorType.InvalidComfyUIArgs,
        [ServicesError.Reasons.CONNECTION_FAILED]: AgentRuntimeErrorType.InvalidProviderAPIKey, // Trigger auth dialog for connection issues
        [ServicesError.Reasons.UPLOAD_FAILED]: AgentRuntimeErrorType.ComfyUIBizError,
        [ServicesError.Reasons.EXECUTION_FAILED]: AgentRuntimeErrorType.ComfyUIWorkflowError,
        [ServicesError.Reasons.MODEL_NOT_FOUND]: AgentRuntimeErrorType.ModelNotFound,
        [ServicesError.Reasons.EMPTY_RESULT]: AgentRuntimeErrorType.ComfyUIBizError,
        [ServicesError.Reasons.IMAGE_FETCH_FAILED]: AgentRuntimeErrorType.ComfyUIBizError,
        [ServicesError.Reasons.IMAGE_TOO_LARGE]: AgentRuntimeErrorType.ComfyUIBizError,
        [ServicesError.Reasons.UNSUPPORTED_PROTOCOL]: AgentRuntimeErrorType.ComfyUIBizError,
        [ServicesError.Reasons.MODEL_VALIDATION_FAILED]: AgentRuntimeErrorType.ModelNotFound,
        [ServicesError.Reasons.WORKFLOW_BUILD_FAILED]: AgentRuntimeErrorType.ComfyUIWorkflowError,
      };
      return mapping[error.reason] || AgentRuntimeErrorType.ComfyUIBizError;
    }

    if (error instanceof UtilsError || error instanceof ModelResolverError) {
      const mapping: Record<string, string> = {
        CONNECTION_ERROR: AgentRuntimeErrorType.ComfyUIServiceUnavailable,
        DETECTION_FAILED: AgentRuntimeErrorType.ComfyUIBizError,
        INVALID_API_KEY: AgentRuntimeErrorType.InvalidProviderAPIKey,
        INVALID_MODEL_FORMAT: AgentRuntimeErrorType.ComfyUIBizError,
        MODEL_NOT_FOUND: AgentRuntimeErrorType.ModelNotFound,
        NO_BUILDER_FOUND: AgentRuntimeErrorType.ComfyUIWorkflowError,
        PERMISSION_DENIED: AgentRuntimeErrorType.PermissionDenied,
        ROUTING_FAILED: AgentRuntimeErrorType.ComfyUIWorkflowError,
        SERVICE_UNAVAILABLE: AgentRuntimeErrorType.ComfyUIServiceUnavailable,
      };
      return mapping[error.reason] || AgentRuntimeErrorType.ComfyUIBizError;
    }

    return AgentRuntimeErrorType.ComfyUIBizError;
  }
}

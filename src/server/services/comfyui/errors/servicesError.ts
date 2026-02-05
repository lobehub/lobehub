import { ComfyUIInternalError } from './base';

/**
 * Services layer error
 *
 * Thrown by service classes, including:
 * - Client communication errors
 * - Authentication and authorization failures
 * - Image processing errors
 * - Workflow execution failures
 * - Model validation errors
 */
export class ServicesError extends ComfyUIInternalError {
  constructor(message: string, reason: string, details?: Record<string, any>) {
    super(message, reason, details);
    this.name = 'ServicesError';
  }
  /* eslint-disable sort-keys-fix/sort-keys-fix */
  static readonly Reasons = {
    // Client errors
    INVALID_ARGS: 'INVALID_ARGS',
    INVALID_AUTH: 'INVALID_AUTH',
    CONNECTION_FAILED: 'CONNECTION_FAILED',
    INVALID_CONFIG: 'INVALID_CONFIG',
    EXECUTION_FAILED: 'EXECUTION_FAILED',
    UPLOAD_FAILED: 'UPLOAD_FAILED',

    // Image service errors
    MODEL_NOT_FOUND: 'MODEL_NOT_FOUND',
    EMPTY_RESULT: 'EMPTY_RESULT',
    IMAGE_FETCH_FAILED: 'IMAGE_FETCH_FAILED',
    IMAGE_TOO_LARGE: 'IMAGE_TOO_LARGE',
    UNSUPPORTED_PROTOCOL: 'UNSUPPORTED_PROTOCOL',

    // Model resolver errors
    MODEL_VALIDATION_FAILED: 'MODEL_VALIDATION_FAILED',

    // Workflow builder errors
    WORKFLOW_BUILD_FAILED: 'WORKFLOW_BUILD_FAILED',
  } as const;
  /* eslint-enable sort-keys-fix/sort-keys-fix */
}

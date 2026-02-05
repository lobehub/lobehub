import { ComfyUIInternalError } from './base';

/**
 * Utils layer error
 *
 * Thrown by utility functions, including:
 * - Connection errors
 * - Detection failures
 * - Model resolution errors
 * - Routing failures
 * - Service availability issues
 */
export class UtilsError extends ComfyUIInternalError {
  constructor(message: string, reason: string, details?: Record<string, any>) {
    super(message, reason, details);
    this.name = 'UtilsError';
  }
  /* eslint-disable sort-keys-fix/sort-keys-fix */
  static readonly Reasons = {
    CONNECTION_ERROR: 'CONNECTION_ERROR',
    // Detector reasons
    DETECTION_FAILED: 'DETECTION_FAILED',
    INVALID_API_KEY: 'INVALID_API_KEY',
    INVALID_MODEL_FORMAT: 'INVALID_MODEL_FORMAT',
    // Model resolver reasons
    MODEL_NOT_FOUND: 'MODEL_NOT_FOUND',
    NO_BUILDER_FOUND: 'NO_BUILDER_FOUND',
    PERMISSION_DENIED: 'PERMISSION_DENIED',
    // Router reasons
    ROUTING_FAILED: 'ROUTING_FAILED',
    SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  } as const;
  /* eslint-enable sort-keys-fix/sort-keys-fix */
}

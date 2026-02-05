/**
 * Model Resolver Error
 *
 * Error class for model resolution failures
 * Simplified after moving main logic to service layer
 */

/**
 * Internal error class for model resolver
 *
 * This error is thrown by model resolver when it cannot find models
 * or encounters issues with the ComfyUI server.
 * It will be caught and converted to framework errors at the main entry level.
 */
export class ModelResolverError extends Error {
  public readonly reason: string;
  public readonly details?: Record<string, any>;

  constructor(reason: string, message: string, details?: Record<string, any>) {
    super(message);
    this.name = 'ModelResolverError';
    this.reason = reason;
    this.details = details;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ModelResolverError);
    }
  }

  /* eslint-disable sort-keys-fix/sort-keys-fix */
  static readonly Reasons = {
    COMPONENT_NOT_FOUND: 'COMPONENT_NOT_FOUND',
    CONNECTION_ERROR: 'CONNECTION_ERROR',
    INVALID_API_KEY: 'INVALID_API_KEY',
    INVALID_MODEL_FORMAT: 'INVALID_MODEL_FORMAT',
    MODEL_NOT_FOUND: 'MODEL_NOT_FOUND',
    NO_MODELS_AVAILABLE: 'NO_MODELS_AVAILABLE',
    PERMISSION_DENIED: 'PERMISSION_DENIED',
    SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  } as const;
  /* eslint-enable sort-keys-fix/sort-keys-fix */
}

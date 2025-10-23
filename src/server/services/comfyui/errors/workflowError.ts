import { ComfyUIInternalError } from './base';

/**
 * Workflow layer error
 *
 * Thrown when workflow construction or execution fails, including:
 * - Invalid workflow configuration
 * - Missing required components (VAE, encoder, etc.)
 * - Unsupported model types
 * - Invalid workflow parameters
 */
export class WorkflowError extends ComfyUIInternalError {
  constructor(message: string, reason: string, details?: Record<string, any>) {
    super(message, reason, details);
    this.name = 'WorkflowError';
  }
  /* eslint-disable sort-keys-fix/sort-keys-fix */
  static readonly Reasons = {
    INVALID_CONFIG: 'INVALID_CONFIG',
    INVALID_PARAMS: 'INVALID_PARAMS',
    MISSING_COMPONENT: 'MISSING_COMPONENT',
    MISSING_ENCODER: 'MISSING_ENCODER',
    UNSUPPORTED_MODEL: 'UNSUPPORTED_MODEL',
  } as const;
  /* eslint-enable sort-keys-fix/sort-keys-fix */
}

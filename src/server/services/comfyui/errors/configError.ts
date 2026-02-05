import { ComfyUIInternalError } from './base';

/**
 * Config layer error
 *
 * Thrown when configuration issues occur, including:
 * - Invalid configuration format
 * - Missing required configuration
 * - Configuration parsing errors
 * - Registry errors
 */
export class ConfigError extends ComfyUIInternalError {
  constructor(message: string, reason: string, details?: Record<string, any>) {
    super(message, reason, details);
    this.name = 'ConfigError';
  }

  /* eslint-disable sort-keys-fix/sort-keys-fix */
  static readonly Reasons = {
    CONFIG_PARSE_ERROR: 'CONFIG_PARSE_ERROR',
    INVALID_CONFIG: 'INVALID_CONFIG',
    MISSING_CONFIG: 'MISSING_CONFIG',
    REGISTRY_ERROR: 'REGISTRY_ERROR',
  } as const;
  /* eslint-enable sort-keys-fix/sort-keys-fix */
}

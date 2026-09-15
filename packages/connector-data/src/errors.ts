import type { ConnectorDataProvider } from './providers';

/** Options used to retain a connector failure across collection boundaries. */
export interface ConnectorDataErrorOptions {
  /** Original upstream error or response retained without cloning or serialization. */
  cause?: unknown;
  /** Stable connector-owned failure code. */
  code: string;
  /** Original upstream error message when one is available. */
  message?: string;
  /** Connector sub-operation that failed. */
  operation: string;
  /** Connector provider that executed the failed operation. */
  provider: ConnectorDataProvider;
  /** Whether the same operation can succeed without user intervention. */
  retryable: boolean;
}

/**
 * Reads an error message without replacing upstream diagnostic content.
 *
 * Use when:
 * - Persisting a rejected provider sub-operation
 * - Wrapping an upstream connector failure
 *
 * Expects:
 * - Any thrown JavaScript value
 *
 * Returns:
 * - The original Error message, string value, or undefined when no message exists
 */
export const getConnectorErrorMessage = (error: unknown): string | undefined => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error === undefined) return;
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    return error.message;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};

/**
 * Connector-owned protocol or validation failure with its diagnostic message preserved.
 *
 * Use when:
 * - Reporting a connector failure created by our own protocol or validation code
 *
 * Expects:
 * - Stable provider, operation, code, and retryability metadata
 *
 * Returns:
 * - An Error carrying connector-owned structured metadata
 */
export class ConnectorDataError extends Error {
  readonly code: string;
  readonly operation: string;
  readonly provider: ConnectorDataProvider;
  readonly retryable: boolean;

  constructor({ cause, code, message, operation, provider, retryable }: ConnectorDataErrorOptions) {
    super(message ?? `${provider} ${operation} failed`, { cause });

    this.name = 'ConnectorDataError';
    this.code = code;
    this.operation = operation;
    this.provider = provider;
    this.retryable = retryable;
  }
}

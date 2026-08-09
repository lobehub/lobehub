import type { ConnectorDataProvider } from './providers';

/** Options used to create a sanitized Connector Data boundary error. */
export interface ConnectorDataErrorOptions {
  code: string;
  operation: string;
  provider: ConnectorDataProvider;
  retryable: boolean;
}

/** Sanitized provider error safe to propagate across connector collection boundaries. */
export class ConnectorDataError extends Error {
  readonly code: string;
  readonly operation: string;
  readonly provider: ConnectorDataProvider;
  readonly retryable: boolean;

  constructor({ code, operation, provider, retryable }: ConnectorDataErrorOptions) {
    super(`${provider} ${operation} failed`);

    this.name = 'ConnectorDataError';
    this.code = code;
    this.operation = operation;
    this.provider = provider;
    this.retryable = retryable;
  }
}

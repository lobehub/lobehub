interface ConnectorPageState {
  available: boolean;
  error?: unknown;
  hasProvider: boolean;
  hasServer: boolean;
  isInitialLoading: boolean;
}

export type ConnectorPageView = 'error' | 'hidden' | 'loading' | 'ready';

/**
 * What a connector page shows for the user's account. A failed refresh keeps a known connection
 * on screen; only a failure with nothing to show becomes the error state.
 */
export const resolveConnectorPageView = ({
  available,
  error,
  hasProvider,
  hasServer,
  isInitialLoading,
}: ConnectorPageState): ConnectorPageView => {
  if (!available || !hasProvider) return 'hidden';
  if (isInitialLoading) return 'loading';
  return error && !hasServer ? 'error' : 'ready';
};

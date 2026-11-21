interface AgentToolsState {
  available: boolean;
  error?: unknown;
  hasProvider: boolean;
  hasServer: boolean;
  isInitialLoading: boolean;
}

export type AgentToolsView = 'error' | 'hidden' | 'loading' | 'ready';

/**
 * What the Agent tools section shows. A failed refresh keeps a known connection
 * on screen; only a failure with nothing to show becomes the error state.
 */
export const resolveAgentToolsView = ({
  available,
  error,
  hasProvider,
  hasServer,
  isInitialLoading,
}: AgentToolsState): AgentToolsView => {
  if (!available || !hasProvider) return 'hidden';
  if (isInitialLoading) return 'loading';
  return error && !hasServer ? 'error' : 'ready';
};

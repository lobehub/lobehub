export interface WorkspaceByokAccessParams {
  userId: string;
  workspaceId: string;
}

/**
 * Whether the workspace may configure and call providers with its own keys.
 * Open by default.
 */
export const isWorkspaceByokAllowed = async (_params: WorkspaceByokAccessParams) => true;

export interface WorkspaceByokGateParams {
  /** The provider id the request asks for. */
  provider: string;
  userId: string;
  workspaceId: string;
}

/**
 * Runs before the server builds a model runtime in a workspace. A business
 * build throws a `ChatCompletionErrorPayload` where the workspace may not call
 * a provider with its own keys; the default lets every request through.
 */
export const assertWorkspaceByokAllowed = async (_params: WorkspaceByokGateParams) => {};

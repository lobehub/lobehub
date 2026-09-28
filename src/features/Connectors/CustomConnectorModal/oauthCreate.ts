export interface OAuthCreateDeps<TPayload> {
  createConnector: (payload: TPayload) => Promise<{ id: string; isNew: boolean }>;
  deleteConnector: (id: string) => Promise<void>;
  startConnectorOAuth: (id: string) => Promise<string>;
  waitForConnectorOAuth: (
    popup: Window | null | undefined,
    connectorId: string,
    authorizationUrl: string,
  ) => Promise<void>;
}

/**
 * Create an OAuth connector and drive its authorize flow in the popup DevModal
 * opened (or the native desktop window).
 *
 * When the flow cannot even start (discovery failed, registration rejected, …)
 * nothing can have been authorized, so the row this attempt created is rolled
 * back instead of leaving a disconnected, tool-less connector behind — the same
 * `isNew` guard as the non-OAuth path, so a pre-existing connector is never
 * deleted. Once the popup is navigated the row is kept: a "dismissed" result may
 * still hide a successful callback whose status message was lost.
 */
export const executeOAuthCreate = async <TPayload>(
  payload: TPayload,
  popup: Window | null | undefined,
  deps: OAuthCreateDeps<TPayload>,
): Promise<void> => {
  const { id, isNew } = await deps.createConnector(payload);

  let authorizationUrl: string;
  try {
    authorizationUrl = await deps.startConnectorOAuth(id);
  } catch (error) {
    if (isNew) await deps.deleteConnector(id).catch(() => {});
    throw error;
  }

  await deps.waitForConnectorOAuth(popup, id, authorizationUrl);
};

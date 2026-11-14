import { restoreConnector } from '@/store/tool/slices/connector/replaceConnector';
import { connectorSelectors } from '@/store/tool/slices/connector/selectors';
import type { ToolStore } from '@/store/tool/store';
import { ConnectorOAuthError, waitForConnectorOAuth } from '@/utils/connectorOAuth';

type ConnectorPatch = Parameters<ToolStore['updateConnector']>[1];

/**
 * Store an OAuth connector edit, then authorize it in `popup` (or the native
 * desktop window). The authorization needs the edited endpoint and client, so
 * they are stored first; the server leaves the row disconnected until the
 * callback connects it. When the authorization is denied, dismissed or times
 * out, the connector is put back the way it was, so its tools never run
 * against an endpoint nobody authorized.
 *
 * A popup that closes without a result is a success when the callback did
 * connect the row: providers whose COOP policy severs `window.opener` lose the
 * callback's message.
 *
 * The callback's sync only adds tools, so an authorized edit lists them again
 * to drop the ones the edited endpoint no longer has.
 */
export const saveOAuthConnectorEdit = async (
  id: string,
  patch: ConnectorPatch,
  popup: Window | null | undefined,
  get: () => ToolStore,
): Promise<void> => {
  const previous = await get().getConnectorForEdit(id);
  await get().updateConnector(id, patch);

  try {
    const authorizationUrl = await get().startConnectorOAuth(id);
    await waitForConnectorOAuth(popup, id, authorizationUrl);
  } catch (error) {
    if (!(await isConnectedAfterDismiss(error, id, get))) {
      await restoreConnector(previous, get).catch((restoreError) => {
        console.error('[connector] restore of connector %s failed:', id, restoreError);
      });
      throw error;
    }
  }

  // The edit is authorized and stored: a failed re-list only leaves extra tools
  await get()
    .syncConnectorTools(id, { pruneMissingAutoTools: true })
    .catch((syncError) => {
      console.error('[connector] tool sync of connector %s failed:', id, syncError);
    });
};

const isConnectedAfterDismiss = async (error: unknown, id: string, get: () => ToolStore) => {
  if (!(error instanceof ConnectorOAuthError) || error.reason !== 'dismissed') return false;
  try {
    await get().fetchConnectors();
    return connectorSelectors.connectorById(id)(get())?.status === 'connected';
  } catch {
    return false;
  }
};

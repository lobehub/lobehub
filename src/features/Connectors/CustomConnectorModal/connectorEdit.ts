import { restoreConnector } from '@/store/tool/slices/connector/replaceConnector';
import type { ToolStore } from '@/store/tool/store';

type ConnectorPatch = Parameters<ToolStore['updateConnector']>[1];

/**
 * Store a connector edit that needs no authorization (no auth, a bearer token,
 * custom headers), then list its tools again: a changed endpoint, command or
 * credential can expose different tools, so the new list replaces the stored
 * one.
 *
 * When that list can't be read (an unreachable endpoint, a stdio command that
 * doesn't start), the connector is put back the way it was. Otherwise its old
 * tools would stay listed and callable against the endpoint the edit stored.
 */
export const saveConnectorEdit = async (
  id: string,
  patch: ConnectorPatch,
  get: () => ToolStore,
): Promise<void> => {
  const previous = await get().getConnectorForEdit(id);
  await get().updateConnector(id, patch);

  try {
    await get().syncConnectorTools(id, { pruneMissingAutoTools: true });
  } catch (error) {
    await restoreConnector(previous, get).catch((restoreError) => {
      console.error('[connector] restore of connector %s failed:', id, restoreError);
    });
    throw error;
  }
};

import type { ConnectorVisibility } from '@lobechat/types';

import type { PluginModel } from '@/database/models/plugin';

/**
 * Remove the legacy plugin projection of a base Composio connection that is
 * being removed. In a workspace every member's projection row of an app is in
 * scope. A shared connection is the workspace's projection of the app, so all
 * of it goes. A private connection is one member's: only the rows mirroring
 * its account go, and a teammate's legacy connection of the same app stays.
 */
export const removeComposioProjection = async (
  pluginModel: Pick<PluginModel, 'delete' | 'deleteComposioMirrors'>,
  connection: {
    connectedAccountId?: string | null;
    identifier: string;
    visibility?: ConnectorVisibility | null;
  },
): Promise<void> => {
  if (connection.visibility !== 'private') {
    await pluginModel.delete(connection.identifier);
    return;
  }
  if (connection.connectedAccountId) {
    await pluginModel.deleteComposioMirrors(connection.identifier, connection.connectedAccountId);
  }
};

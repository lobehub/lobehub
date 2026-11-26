import type { ConnectorVisibility } from '@lobechat/types';

import type { PluginModel } from '@/database/models/plugin';

/**
 * Remove the legacy plugin projection of a base Composio connection that is
 * being removed. In a workspace every member's projection row of an app is in
 * scope. A shared connection is the workspace's projection of the app, so it
 * goes, except the rows mirroring a member's private connection of the same
 * app, which still runs on them. A private connection is one member's: only the
 * rows mirroring its account go, and a teammate's legacy connection stays.
 */
export const removeComposioProjection = async (
  pluginModel: Pick<
    PluginModel,
    'deleteComposioMirrors' | 'deleteComposioProjectionKeepingPrivate'
  >,
  connection: {
    connectedAccountId?: string | null;
    identifier: string;
    visibility?: ConnectorVisibility | null;
  },
): Promise<void> => {
  if (connection.visibility !== 'private') {
    await pluginModel.deleteComposioProjectionKeepingPrivate(connection.identifier);
    return;
  }
  if (connection.connectedAccountId) {
    await pluginModel.deleteComposioMirrors(connection.identifier, connection.connectedAccountId);
  }
};

/**
 * The legacy plugin projection is workspace-wide, but a pending hosted OAuth
 * link (`customParams.composio.redirectUrl`) is a live capability of whoever
 * started it: a teammate redeeming it would bind their own provider account to
 * that connection (a private one included). Every read that returns plugin
 * rows to a client keeps the link only for its linker; outside a workspace
 * every row is the caller's own.
 */
export const redactForeignComposioLinks = <
  T extends {
    customParams?: { composio?: { linkedByUserId?: string; redirectUrl?: string } } | null;
  },
>(
  plugins: T[],
  ctx: { userId: string; workspaceId?: string | null },
): T[] =>
  plugins.map((plugin) => {
    const composio = plugin.customParams?.composio;
    if (!composio?.redirectUrl || !ctx.workspaceId || composio.linkedByUserId === ctx.userId)
      return plugin;
    const { redirectUrl: _redirectUrl, ...rest } = composio;
    return { ...plugin, customParams: { ...plugin.customParams, composio: rest } };
  });

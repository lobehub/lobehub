import { COMPOSIO_APP_TYPES } from '@lobechat/const';
import type { CustomPluginParams } from '@lobechat/types';

import type { ComposioPluginMirror, ConnectorModel } from '@/database/models/connector';

export const VALID_COMPOSIO_IDENTIFIERS = new Set(
  COMPOSIO_APP_TYPES.map((type) => type.identifier),
);

/**
 * The legacy plugin projection rows (`user_installed_plugins.customParams.composio`)
 * a run may use, active ones first.
 *
 * A workspace keeps one projection row per member for the same app, and a
 * row can mirror a connector this run did not resolve (a private connector
 * read by another member, another agent's row): using it would resurrect the
 * very connection the run may not use. Only a legacy connection — no
 * connector row behind its account — is served from the projection
 * (see `ConnectorModel.pickLegacyComposioMirrors`).
 *
 * Shared by every reader of the projection (tool manifests, account
 * resolution, connected-service facts), so they agree on what is connected.
 */
export const selectLegacyComposioMirrors = async <
  T extends {
    customParams?: CustomPluginParams | null;
    identifier: string;
    userId: string;
  },
>(
  plugins: T[],
  connectorModel: Pick<ConnectorModel, 'pickLegacyComposioMirrors'> | undefined,
): Promise<(ComposioPluginMirror & { plugin: T })[]> => {
  const mirrors = plugins.flatMap((plugin) => {
    const composio = plugin.customParams?.composio;
    if (!VALID_COMPOSIO_IDENTIFIERS.has(plugin.identifier) || !composio?.connectedAccountId) {
      return [];
    }
    return [
      {
        connectedAccountId: composio.connectedAccountId,
        identifier: plugin.identifier,
        ownerUserId: composio.linkedByUserId ?? plugin.userId,
        plugin,
      },
    ];
  });

  const legacy = connectorModel ? await connectorModel.pickLegacyComposioMirrors(mirrors) : mirrors;
  const isActive = (mirror: (typeof legacy)[number]) =>
    mirror.plugin.customParams?.composio?.status === 'ACTIVE';
  return [...legacy.filter(isActive), ...legacy.filter((mirror) => !isActive(mirror))];
};

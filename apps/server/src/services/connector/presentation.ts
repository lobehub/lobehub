import type { ConnectorAuthKind } from '@lobechat/types';

import type { DecryptedConnector } from '@/database/models/connector';

import { type ConnectorLinksContext, loadConnectorLinksMap } from './links';

/** Only this allowlist crosses the API boundary; credentials stay server-side. */
export const loadConnectorPresentation = async (
  connectors: DecryptedConnector[],
  ctx: ConnectorLinksContext,
) => {
  const linksMap = await loadConnectorLinksMap(connectors, ctx);
  return new Map(
    connectors.map((connector) => {
      const links = linksMap.get(connector.id) ?? [];
      const authKind: ConnectorAuthKind = links.length
        ? 'oauth2'
        : (connector.credentials?.type ?? (connector.oidcConfig ? 'oauth2' : 'none'));
      return [
        connector.id,
        {
          authKind,
          links: links.map((link) => ({
            id: link.id,
            name: link.name,
            status: link.status,
            profile: link.profile,
            authorizedByName: link.authorizedByName ?? null,
            authorizedByAvatar: link.authorizedByAvatar ?? null,
            createdAt: link.createdAt.toISOString(),
          })),
        },
      ];
    }),
  );
};

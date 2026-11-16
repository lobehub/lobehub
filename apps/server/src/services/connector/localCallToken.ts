import { connectorMcpEndpoint, isDeviceOnlyMcpEndpoint } from '@lobechat/utils/mcpEndpoint';
import { TRPCError } from '@trpc/server';

import type { ConnectorModel } from '@/database/models/connector';

import { getConnectorLinkModel, loadConnectorLinksMap, pickPrimaryLink } from './links';
import { ensureFreshLinkToken } from './tokens';

/**
 * The current OAuth access token of an HTTP connector the creator's desktop app
 * calls itself: one only their machine reaches (localhost / LAN, or set to
 * connect through the device). The edit read (`getForEdit`) never returns OAuth
 * tokens, so without this such a call would reach the server unauthenticated.
 *
 * Narrow on purpose: the creator only, and only an account they authorized (a
 * workspace owner can manage the row but must not take a token another member
 * authorized); the access token only (never the refresh token or client
 * secret), refreshed first when due. This is what the device gateway already
 * forwards to the user's device for the same call. `linkId` picks the account
 * of a connector holding several, its primary account otherwise. `null` when
 * the connector has no OAuth account or runs elsewhere.
 */
export const getConnectorLocalCallToken = async (
  ctx: { connectorModel: ConnectorModel; userId: string },
  id: string,
  linkId?: string,
): Promise<{ accessToken: string; type: 'oauth2' } | null> => {
  const connector = await ctx.connectorModel.findById(id);
  if (!connector) throw new TRPCError({ code: 'NOT_FOUND', message: 'Connector not found' });
  if (connector.userId !== ctx.userId) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Only the member who connected this connector can run it from their device.',
    });
  }

  const endpoint = connectorMcpEndpoint(connector);
  if (endpoint.type === 'stdio' || !connector.mcpServerUrl || !isDeviceOnlyMcpEndpoint(endpoint))
    return null;

  const links = (await loadConnectorLinksMap([connector], ctx)).get(connector.id) ?? [];
  const link = linkId ? links.find((item) => item.id === linkId) : pickPrimaryLink(links);
  if (!link) {
    if (linkId) throw new TRPCError({ code: 'NOT_FOUND', message: 'Connector account not found' });
    return null;
  }
  if (link.userId !== ctx.userId) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Only the member who connected this account can run it from their device.',
    });
  }

  const fresh = await ensureFreshLinkToken(
    connector,
    link,
    getConnectorLinkModel(ctx),
    ctx.connectorModel,
  );
  return fresh.credentials.accessToken
    ? { accessToken: fresh.credentials.accessToken, type: 'oauth2' }
    : null;
};

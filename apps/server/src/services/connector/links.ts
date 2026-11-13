import {
  resolveConnectorLinkParam,
  sanitizeConnectorPromptText,
  splitConnectorLinkArg,
} from '@lobechat/mecha';

import type { ConnectorModel, DecryptedConnector } from '@/database/models/connector';
import type { ConnectorLinkModel, DecryptedConnectorLink } from '@/database/models/connectorLink';

import { ensureFreshLinkToken } from './tokens';

export interface ConnectorLinksContext {
  connectorLinkModel?: ConnectorLinkModel;
  connectorModel: ConnectorModel;
}
export const getConnectorLinkModel = (ctx: ConnectorLinksContext) =>
  ctx.connectorLinkModel ?? ctx.connectorModel.getLinkModel();

export const loadConnectorLinksMap = async (
  connectors: DecryptedConnector[],
  ctx: ConnectorLinksContext,
): Promise<Map<string, DecryptedConnectorLink[]>> => {
  const map = new Map<string, DecryptedConnectorLink[]>();
  if (!connectors.length) return map;
  const model = getConnectorLinkModel(ctx);
  for (const connector of connectors) await model.adoptLegacyCredentials(connector);
  for (const link of await model.listByConnectorIds(connectors.map((c) => c.id))) {
    const links = map.get(link.userConnectorId) ?? [];
    links.push(link);
    map.set(link.userConnectorId, links);
  }
  return map;
};
export const withLinkCredentials = (
  connector: DecryptedConnector,
  link: DecryptedConnectorLink,
): DecryptedConnector => ({
  ...connector,
  credentials: link.credentials,
  tokenExpiresAt: link.tokenExpiresAt,
});

export const pickPrimaryLink = <T extends { status: string }>(links: readonly T[]): T | undefined =>
  links.find((link) => link.status === 'connected') ?? links[0];

export class ConnectorLinkSelectionError extends Error {}

export const resolveLinkedCall = async (
  params: {
    connector: DecryptedConnector;
    argsStr?: string;
    linkId?: string;
    param?: string;
    schemas?: readonly unknown[];
    fromApp?: boolean;
    isShareVisitor?: boolean;
  },
  ctx: ConnectorLinksContext,
): Promise<{
  connector: DecryptedConnector;
  argsStr: string;
  linkId?: string;
  linkName?: string;
}> => {
  const { connector } = params;
  const links = (await loadConnectorLinksMap([connector], ctx)).get(connector.id) ?? [];
  if (!links.length) {
    if (
      params.linkId ||
      connector.links?.length ||
      (connector.oidcConfig && !connector.credentials)
    ) {
      throw new ConnectorLinkSelectionError(
        'No connected accounts. Ask the user to connect an account in Settings > Connectors.',
      );
    }
    return { connector, argsStr: params.argsStr ?? '{}' };
  }
  const param = params.param ?? resolveConnectorLinkParam(params.schemas ?? []);
  if (params.fromApp && links.length > 1 && !params.linkId)
    throw new ConnectorLinkSelectionError(
      `${param} from the initiating tool call is required for this interactive view`,
    );
  let split;
  try {
    split = splitConnectorLinkArg(params.argsStr ?? '{}', param);
  } catch (error) {
    throw new ConnectorLinkSelectionError(
      error instanceof Error ? error.message : 'Invalid account selection',
    );
  }
  const linkId = params.linkId ?? split.linkId;
  if (params.linkId && split.linkId && params.linkId !== split.linkId)
    throw new ConnectorLinkSelectionError('Conflicting account selections');
  const choices = JSON.stringify(
    links.map((link, i) => ({
      link_id: link.id,
      link_name: params.isShareVisitor
        ? `Account ${i + 1}`
        : sanitizeConnectorPromptText(link.name),
    })),
  );
  if (!linkId && links.length > 1)
    throw new ConnectorLinkSelectionError(`${param} is required. Select an account: ${choices}`);
  const link = linkId ? links.find((l) => l.id === linkId) : links[0];
  if (!link)
    throw new ConnectorLinkSelectionError(
      `The selected account no longer exists. Current accounts: ${choices}`,
    );
  const fresh = await ensureFreshLinkToken(
    connector,
    link,
    getConnectorLinkModel(ctx),
    ctx.connectorModel,
  );
  return {
    connector: withLinkCredentials(connector, fresh),
    argsStr: split.argsStr,
    linkId: fresh.id,
    linkName: params.isShareVisitor
      ? `Account ${links.indexOf(link) + 1}`
      : sanitizeConnectorPromptText(fresh.name),
  };
};

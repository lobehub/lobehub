import {
  resolveConnectorLinkParam,
  sanitizeConnectorPromptText,
  splitConnectorLinkArg,
} from '@lobechat/mecha';

import type { ConnectorModel, DecryptedConnector } from '@/database/models/connector';
import type { ConnectorLinkModel, DecryptedConnectorLink } from '@/database/models/connectorLink';

import { ensureFreshConnectorToken, ensureFreshLinkToken } from './tokens';

export interface ConnectorLinksContext {
  connectorLinkModel?: ConnectorLinkModel;
  connectorModel: ConnectorModel;
}
export const getConnectorLinkModel = (ctx: ConnectorLinksContext) =>
  ctx.connectorLinkModel ?? ctx.connectorModel.getLinkModel();

/**
 * The links context of a connector row's own scope. A private agent's
 * workspace run can resolve its owner's personal connector (`workspace_id IS
 * NULL`), whose accounts the run's workspace-scoped models can neither list
 * nor write (`ConnectorModel.forRow`). Every other row is in the run's scope.
 */
export const connectorLinksContextForRow = (
  ctx: ConnectorLinksContext,
  row: Pick<DecryptedConnector, 'userId' | 'workspaceId'>,
): ConnectorLinksContext => {
  // Only a personal row can lie outside the run's scope
  if (row.workspaceId !== null) return ctx;
  const connectorModel = ctx.connectorModel.forRow(row);
  return connectorModel === ctx.connectorModel ? ctx : { connectorModel };
};

/**
 * Accounts exist only for OAuth connectors: an authorization needs the
 * connector's OAuth client, and replacing OAuth with static credentials
 * removes both the client and the accounts. A single OAuth token written
 * before accounts existed reads as one account. Evaluation mocks keep their
 * single token.
 */
const mayHaveLinks = (connector: DecryptedConnector) =>
  !connector.metadata?.agentEval &&
  (!!connector.oidcConfig || connector.credentials?.type === 'oauth2');

export const loadConnectorLinksMap = async (
  connectors: DecryptedConnector[],
  ctx: ConnectorLinksContext,
): Promise<Map<string, DecryptedConnectorLink[]>> => {
  const map = new Map<string, DecryptedConnectorLink[]>();
  const candidates = connectors.filter(mayHaveLinks);
  if (!candidates.length) return map;
  // Each row's accounts are listed in its own scope: the run's, or the
  // caller's personal one (`connectorLinksContextForRow`)
  const groups = new Map<ConnectorLinksContext, DecryptedConnector[]>();
  let personal: ConnectorLinksContext | undefined;
  for (const connector of candidates) {
    let rowContext = connectorLinksContextForRow(ctx, connector);
    if (rowContext !== ctx) rowContext = personal ??= rowContext;
    groups.set(rowContext, [...(groups.get(rowContext) ?? []), connector]);
  }
  for (const [rowContext, rows] of groups) {
    const model = getConnectorLinkModel(rowContext);
    for (const link of await model.listByConnectorIds(rows.map((c) => c.id))) {
      const links = map.get(link.userConnectorId) ?? [];
      links.push(link);
      map.set(link.userConnectorId, links);
    }
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

/** The connector account a call was pinned to no longer exists. */
export class ConnectorAccountGoneError extends Error {
  constructor() {
    super('Connector account no longer exists');
    this.name = 'ConnectorAccountGoneError';
  }
}

/**
 * The connector ready to call: an OAuth connector's credentials live on its accounts, not on the
 * row, so this picks the account (`linkId`, else the primary one), refreshes its token and puts its
 * credentials on the connector. A connector without accounts refreshes its own token. Returns the
 * account used, so a caller that must keep talking as the same identity can pin it, and how many
 * accounts the connector has.
 */
export const resolveConnectorAccount = async (
  connector: DecryptedConnector,
  ctx: ConnectorLinksContext,
  linkId?: string,
): Promise<{
  accountCount: number;
  connector: DecryptedConnector;
  /** The account used, as stored; none for a connector without accounts. */
  link?: DecryptedConnectorLink;
  linkId?: string;
}> => {
  // Read and refreshed in the row's own scope (a personal row in a workspace run)
  const rowContext = connectorLinksContextForRow(ctx, connector);
  const links = (await loadConnectorLinksMap([connector], rowContext)).get(connector.id) ?? [];
  const link = linkId ? links.find((l) => l.id === linkId) : pickPrimaryLink(links);
  if (linkId && !link) throw new ConnectorAccountGoneError();
  if (!link)
    return {
      accountCount: links.length,
      connector: await ensureFreshConnectorToken(connector, rowContext.connectorModel),
    };
  const fresh = await ensureFreshLinkToken(connector, link, rowContext.connectorModel);
  return {
    accountCount: links.length,
    connector: withLinkCredentials(connector, fresh),
    link,
    linkId: link.id,
  };
};

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
  const rowContext = connectorLinksContextForRow(ctx, connector);
  const links = (await loadConnectorLinksMap([connector], rowContext)).get(connector.id) ?? [];
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
  const fresh = await ensureFreshLinkToken(connector, link, rowContext.connectorModel);
  return {
    connector: withLinkCredentials(connector, fresh),
    argsStr: split.argsStr,
    linkId: fresh.id,
    linkName: params.isShareVisitor
      ? `Account ${links.indexOf(link) + 1}`
      : sanitizeConnectorPromptText(fresh.name),
  };
};

import { randomUUID } from 'node:crypto';

import {
  hasCallableMcpEndpoint,
  isMarketplaceInstallCompleted,
  MARKETPLACE_INSTALL_COMPLETED_KEY,
  SSRF_SAFE_TRANSPORT_KEY,
} from '@lobechat/const';
import debug from 'debug';

import type { DecryptedConnector } from '@/database/models/connector';
import { ConnectorModel } from '@/database/models/connector';
import { ConnectorToolModel } from '@/database/models/connectorTool';
import { PluginModel } from '@/database/models/plugin';
import { WorkspaceMemberModel } from '@/database/models/workspaceMember';
import {
  ConnectorMcpConnectionType,
  ConnectorSourceType,
  ConnectorStatus,
} from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { buildCloudMcpManifest, cloudManifestTools } from '@/libs/mcp/cloudManifest';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { canManageWorkspaceConnectors } from '@/server/routers/lambda/_helpers/connectorManagePolicy';

import {
  buildListedToolSyncInputs,
  listConnectorToolSyncInputs,
  writeConnectorToolSyncInputs,
} from './sync';

const log = debug('lobe-server:connector:marketplace-install');

interface MarketConnection {
  auth?: { token?: string; type?: string };
  configSchema?: unknown;
  headers?: Record<string, string>;
  type?: string;
  url?: string;
}

/** The parts of a marketplace MCP manifest (`market.getMcpManifest`) an install reads. */
export interface MarketMcpManifest {
  api?: unknown[];
  deploymentOptions?: { connection?: MarketConnection }[];
  description?: string;
  /** The market's hosted endpoint for a stdio server, when it runs one. */
  haveCloudEndpoint?: unknown;
  icon?: string;
  name?: string;
  tools?: unknown[];
  version?: string;
}

export type MarketplaceDeployment =
  | { auth?: MarketConnection['auth']; headers?: Record<string, string>; type: 'http'; url: string }
  | { cloudEndPoint: unknown; headers?: Record<string, string>; type: 'cloud' };

/**
 * Why a marketplace MCP cannot be installed without the user:
 * - `config`: it needs settings (an API key…) only the user can fill in;
 * - `oauth`: it signs in with OAuth, which the user authorizes in a browser;
 * - `local-only`: it has no remote endpoint, only a local (stdio) process;
 * - `no-tools`: it lists no tools, so the install would load nothing;
 * - `conflict`: another connector already holds the identifier;
 * - `in-progress`: an install of it started under
 *   {@link MARKETPLACE_INSTALL_LEASE_MS} ago and has not finished;
 * - `forbidden`: the workspace lets only owners and admins add connectors.
 */
export type MarketplaceInstallBlocker =
  'config' | 'conflict' | 'forbidden' | 'in-progress' | 'local-only' | 'no-tools' | 'oauth';

export type MarketplaceInstallOutcome =
  /** A connector was created, its tools synced, and the install marked finished. */
  | { status: 'installed' }
  /** A finished marketplace install already holds the identifier; nothing was written. */
  | { status: 'exists' }
  | { blocker: MarketplaceInstallBlocker; status: 'blocked' };

export interface MarketplaceInstallScope {
  serverDB: LobeChatDatabase;
  userId: string;
  workspaceId?: string;
}

const doesConfigSchemaRequireInput = (configSchema: unknown) => {
  if (!configSchema || typeof configSchema !== 'object') return false;
  const { properties, required } = configSchema as {
    properties?: Record<string, unknown>;
    required?: unknown;
  };

  return (
    (Array.isArray(required) && required.some(Boolean)) ||
    (!!properties &&
      Object.values(properties).some(
        (property) => (property as { required?: unknown } | null)?.required === true,
      ))
  );
};

/**
 * Pick the connection a server-side install uses, by the rules the web
 * `installMCPPlugin` applies outside the desktop app: a market-hosted (`cloud`)
 * endpoint for a stdio server first, then an HTTP endpoint. A stdio-only server
 * needs a local process, which a server run cannot start.
 */
export const pickMarketplaceDeployment = (
  manifest: MarketMcpManifest,
): { deployment: MarketplaceDeployment } | { blocker: MarketplaceInstallBlocker } => {
  const options = Array.isArray(manifest.deploymentOptions) ? manifest.deploymentOptions : [];
  const httpOption =
    options.find((option) => option?.connection?.url && option.connection.type === 'http') ??
    options.find((option) => option?.connection?.url && !option.connection.type);
  const stdioOption = options.find(
    (option) =>
      option?.connection?.type === 'stdio' ||
      (!option?.connection?.type && !option?.connection?.url),
  );

  if (stdioOption && manifest.haveCloudEndpoint) {
    const connection = stdioOption.connection ?? {};
    if (doesConfigSchemaRequireInput(connection.configSchema)) return { blocker: 'config' };
    return {
      deployment: {
        cloudEndPoint: manifest.haveCloudEndpoint,
        headers: connection.headers,
        type: 'cloud',
      },
    };
  }

  if (httpOption?.connection?.url) {
    const { auth, configSchema, headers, url } = httpOption.connection;
    if (doesConfigSchemaRequireInput(configSchema)) return { blocker: 'config' };
    if (auth?.type === 'oauth2') return { blocker: 'oauth' };
    return { deployment: { auth, headers, type: 'http', url } };
  }

  return { blocker: 'local-only' };
};

/**
 * How long an unfinished marketplace install may hold its row: past it, the
 * install is taken for dead (its process stopped between creating the row and
 * marking it), and the next install of the same server replaces the row. It is
 * well beyond the time one server run may take.
 */
export const MARKETPLACE_INSTALL_LEASE_MS = 10 * 60 * 1000;

type HolderVerdict =
  'exists' | 'replace' | Extract<MarketplaceInstallBlocker, 'conflict' | 'in-progress'>;

/**
 * What an install does about the base row already holding its identifier:
 * - `exists`: a finished marketplace install, left as it is. That includes a
 *   connected pre-connector install, which its plugin row (with or without a
 *   manifest) lets runs call, as `isMarketplaceInstallRunnable` does;
 * - `in-progress`: an unfinished marketplace install inside the lease, which
 *   its install (this server's, or the web's) may still finish;
 * - `replace`: the caller's own unfinished marketplace install past the lease,
 *   which no run can call: a retry takes it over;
 * - `conflict`: anything else (a custom or builtin connector, a row without an
 *   endpoint, another member's row).
 */
const judgeHolder = (
  holder: {
    mcpConnectionType?: string | null;
    mcpServerUrl?: string | null;
    metadata?: unknown;
    sourceType?: string | null;
    status?: string | null;
    updatedAt: Date;
    userId: string;
  },
  { hasPluginRow, userId }: { hasPluginRow: boolean; userId: string },
): HolderVerdict => {
  if (holder.sourceType !== ConnectorSourceType.marketplace || !hasCallableMcpEndpoint(holder))
    return 'conflict';
  if (isMarketplaceInstallCompleted(holder.metadata)) return 'exists';
  if (hasPluginRow && holder.status === ConnectorStatus.connected) return 'exists';
  if (Date.now() - holder.updatedAt.getTime() < MARKETPLACE_INSTALL_LEASE_MS) return 'in-progress';
  return holder.userId === userId ? 'replace' : 'conflict';
};

const holderOutcome = (verdict: Exclude<HolderVerdict, 'replace'>): MarketplaceInstallOutcome =>
  verdict === 'exists' ? { status: 'exists' } : { blocker: verdict, status: 'blocked' };

/**
 * The outcome of an install that lost the row to its live holder (judged under
 * the claim's lock, or after a re-add): no holder left, or a lease that ran out
 * since, is the next try's to take.
 */
const liveHolderOutcome = (
  holder: Parameters<typeof judgeHolder>[0] | null,
  context: Parameters<typeof judgeHolder>[1],
): MarketplaceInstallOutcome => {
  const verdict = holder ? judgeHolder(holder, context) : 'in-progress';
  return holderOutcome(verdict === 'replace' ? 'in-progress' : verdict);
};

/** The member policy the connector router's `create` applies to a workspace connector. */
const canAddConnector = async ({ serverDB, userId, workspaceId }: MarketplaceInstallScope) => {
  if (!workspaceId) return true;
  const member = await new WorkspaceMemberModel(serverDB, userId).getMember(workspaceId, userId);
  if (!member) return false;
  return canManageWorkspaceConnectors({
    serverDB,
    userId,
    workspaceId,
    workspaceRole: member.role,
  });
};

/**
 * Tags the row an install creates until it marks it finished, so a rollback
 * only deletes a row that is still this install's: a re-add of the identifier
 * meanwhile (the web install) rewrites the metadata, and the row is its own.
 */
const INSTALL_ATTEMPT_KEY = 'marketplaceInstallAttempt';

/**
 * Install a marketplace MCP from the server (Agent Builder / Agent Management)
 * the way the web install does: a `marketplace` row in `user_connectors` with
 * its tools, then the `marketplaceInstalled` mark, which alone makes the row
 * callable. No `user_installed_plugins` row is written.
 *
 * The row is claimed in one serialized step (`createUnlessIdentifierHeld`), so
 * concurrent installs of one server create it once. The install never
 * overwrites a row someone may still use, only an interrupted install's (see
 * {@link judgeHolder}), so a failed tool sync only has to delete the row it
 * created. Its rollback and its finishing writes (tools, status, mark) apply
 * only while no one has re-added the identifier over the row.
 *
 * An HTTP server's tools are the ones it lists, each with the approval the
 * marketplace manifest gives it: the listing cannot carry one.
 */
export const installMarketplaceMcpConnector = async (
  scope: MarketplaceInstallScope,
  identifier: string,
  manifest: MarketMcpManifest,
): Promise<MarketplaceInstallOutcome> => {
  const { serverDB, userId, workspaceId } = scope;

  const [existing, pluginRow] = await Promise.all([
    new ConnectorModel(serverDB, userId, workspaceId).findScopedByIdentifier(identifier),
    new PluginModel(serverDB, userId, workspaceId).findById(identifier),
  ]);
  const holderContext = { hasPluginRow: !!pluginRow, userId };
  // Answered before any write; the claim below judges the holder again under its lock.
  if (existing) {
    const verdict = judgeHolder(existing, holderContext);
    if (verdict !== 'replace') return holderOutcome(verdict);
  }

  if (!(await canAddConnector(scope))) return { blocker: 'forbidden', status: 'blocked' };

  const picked = pickMarketplaceDeployment(manifest);
  if ('blocker' in picked) return { blocker: picked.blocker, status: 'blocked' };
  const { deployment } = picked;

  // The tools the market lists, each with the approval its manifest asks for: a
  // cloud server's whole tool list, and what an HTTP server's own listing lacks.
  const marketTools =
    manifest.api || manifest.tools
      ? cloudManifestTools(
          buildCloudMcpManifest({
            data: manifest,
            plugin: { description: manifest.description, icon: manifest.icon, identifier },
          }),
        )
      : [];
  // Checked before writing
  if (deployment.type === 'cloud' && marketTools.length === 0)
    return { blocker: 'no-tools', status: 'blocked' };

  const token =
    deployment.type === 'http' && deployment.auth?.type === 'bearer'
      ? deployment.auth.token
      : undefined;
  // Only stored credentials need the vault key.
  const gateKeeper = token ? await KeyVaultsGateKeeper.initWithEnvKey() : undefined;
  const connectorModel = new ConnectorModel(serverDB, userId, workspaceId, gateKeeper);
  const connectorToolModel = new ConnectorToolModel(serverDB, userId, workspaceId);

  // The version goes with each call the market is told about.
  const metadata: NonNullable<DecryptedConnector['metadata']> = {
    avatar: manifest.icon,
    description: manifest.description,
    version: manifest.version,
  };
  if (deployment.headers) metadata.customHeaders = deployment.headers;
  if (deployment.type === 'cloud') {
    metadata.cloudEndPoint = deployment.cloudEndPoint;
  } else {
    // The endpoint is the listing's, not one the user entered: an agent's
    // install must not make the server reach a private or metadata address, at
    // the tool sync below nor on any later call (the listing's DNS may change).
    metadata[SSRF_SAFE_TRANSPORT_KEY] = true;
  }

  const attempt = { [INSTALL_ATTEMPT_KEY]: randomUUID() };
  const claim = await connectorModel.createUnlessIdentifierHeld(
    {
      credentials: token ? JSON.stringify({ token, type: 'bearer' }) : null,
      identifier,
      isEnabled: true,
      mcpConnectionType:
        deployment.type === 'cloud'
          ? ConnectorMcpConnectionType.cloud
          : ConnectorMcpConnectionType.http,
      mcpServerUrl: deployment.type === 'http' ? deployment.url : null,
      metadata: { ...metadata, ...attempt },
      name: manifest.name || identifier,
      sourceType: ConnectorSourceType.marketplace,
      status: ConnectorStatus.disconnected,
    },
    { canReplace: (holder) => judgeHolder(holder, holderContext) === 'replace' },
  );
  if ('holder' in claim) return liveHolderOutcome(claim.holder, holderContext);
  const { created } = claim;
  // The identifier may be re-added over the row meanwhile (the web install),
  // which then owns it: the rollback leaves a re-added row as it is.
  const rollback = () => connectorModel.deleteIfMetadataContains(created.id, attempt);

  try {
    // Listed before anything is written to the row: over the SSRF-safe
    // transport for an HTTP server, as the row's mark asks
    const syncInputs =
      deployment.type === 'cloud'
        ? buildListedToolSyncInputs(marketTools)
        : (
            await listConnectorToolSyncInputs(
              created.id,
              { connectorModel, connectorToolModel, userId },
              {
                humanInterventions: new Map(
                  marketTools.map((tool) => [tool.toolName, tool.humanIntervention]),
                ),
              },
            )
          ).syncInputs;

    if (syncInputs.length === 0) {
      await rollback();
      return { blocker: 'no-tools', status: 'blocked' };
    }

    // The tools, the status and the mark, which alone makes the row callable,
    // land together, and only while the row is still this install's: the
    // conditional mark write holds the row's lock to the commit, so a re-add
    // (the web install, which takes the same lock) either waits for it or, made
    // before, leaves this install nothing to write over its metadata (headers
    // its user entered…), tools or status.
    const finished = await serverDB.transaction(async (tx) => {
      const txDB = tx as unknown as LobeChatDatabase;
      const txConnectorModel = new ConnectorModel(txDB, userId, workspaceId);
      const marked = await txConnectorModel.updateMetadataIfContains(created.id, attempt, {
        ...metadata,
        [MARKETPLACE_INSTALL_COMPLETED_KEY]: true,
      });
      if (!marked) return false;
      await writeConnectorToolSyncInputs(created.id, syncInputs, {
        connectorModel: txConnectorModel,
        connectorToolModel: new ConnectorToolModel(txDB, userId, workspaceId),
      });
      return true;
    });
    if (!finished)
      return liveHolderOutcome(
        await connectorModel.findScopedByIdentifier(identifier),
        holderContext,
      );
  } catch (error) {
    // A failed rollback is only logged: an unmarked row stays uncallable.
    await rollback().catch((rollbackError) => {
      log('rollback of connector %s (%s) failed: %O', created.id, identifier, rollbackError);
    });
    throw error;
  }

  return { status: 'installed' };
};

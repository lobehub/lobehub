import type { DeviceAttachment } from '@lobechat/builtin-tool-remote-device';
import type { LobeToolManifest } from '@lobechat/context-engine';
import { FILE_PREVIEW_CHARS, isOversizedFileContent } from '@lobechat/prompts';
import type { FrozenCredentialFacts } from '@lobechat/types';
import { agentShareFileAccessScope, ordinaryFileAccessScope } from '@lobechat/types';
import debug from 'debug';

import { AgentAccountModel } from '@/database/models/agentAccount';
import { ConnectorModel, type DecryptedConnector } from '@/database/models/connector';
import { DocumentModel } from '@/database/models/document';
import { FileModel } from '@/database/models/file';
import type { UserConnectorToolItem } from '@/database/schemas';
import { buildConnectorManifests } from '@/libs/mcp/buildConnectorManifests';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { refreshExpiredConnectorTokens } from '@/server/services/connector/tokens';
import { deviceGateway } from '@/server/services/deviceGateway';
import { getScopedOnlineDevices } from '@/server/services/deviceGateway/scopedDevices';

import type { ExecRunContext } from '../../types';
import { markDegradedStage, traceDiscoveryStage } from '../discoveryTracing';
import { readProjectToolScope } from './projectScope';
import type { ToolDiscoveryDeps } from './types';

const log = debug('lobe-server:ai-agent-service');

/**
 * Start a read now and keep its rejection for the caller's `await`.
 *
 * A promise that rejects before anything awaits it trips Node's
 * `unhandledRejection` even though this code does await it a few lines later,
 * so register a no-op handler on the original and hand the same promise back.
 */
const started = <T>(task: Promise<T>): Promise<T> => {
  task.catch(() => undefined);
  return task;
};

/** The run facts the read wave needs, captured when it starts. */
export interface ToolReadsContext {
  agentConfig: ExecRunContext['agentConfig'];
  attachedFileIds?: string[];
  /**
   * Snapshot of the candidate plugin ids taken when the wave starts — the
   * caller's list later gains turn-scoped builtins (topic reference, bot
   * message, multimodal understanding), and those must not reach connector
   * resolution or the stale-tools refresh.
   */
  candidateIds: string[];
  exclusivePluginIds?: string[];
  isGoalTurn: boolean;
  /** Project the run belongs to (`appContext.projectId`). */
  projectId?: string;
  requestedDeviceId?: string;
  resolvedAgentId: string;
  shareGate: ExecRunContext['shareGate'];
  /**
   * The extension identifiers a share run may discover (connectors, Composio,
   * LobeHub Skills); only these are resolved, so an ungranted one never has
   * its credentials decrypted or its provider called. `undefined` = no gate.
   */
  shareGrantedExtensionIds?: Set<string>;
  topicId: string;
}

/**
 * The credentials the run may reference, read once. Inside a workspace an agent
 * only sees the workspace's shared organization credentials, never the
 * operator's personal ones — the scope is recorded on the snapshot so a step in
 * another scope falls back to a live read.
 *
 * Never fails the turn: without an answer the steps read the list live, exactly
 * as they did before the snapshot existed.
 */
export const readCredentialFacts = async (
  deps: ToolDiscoveryDeps,
): Promise<FrozenCredentialFacts | undefined> => {
  try {
    const marketService = await deps.getMarketService();
    const result = deps.workspaceId
      ? await marketService.market.organizations.creds({ workspaceId: deps.workspaceId }).list()
      : await marketService.market.creds.list();
    const creds = (result as any)?.data ?? [];
    return {
      credentials: creds.map((cred: any) => ({
        description: cred.description,
        key: cred.key,
        name: cred.name,
        ownerDisplayName: cred.ownerDisplayName,
        ownerType: cred.ownerType,
        type: cred.type,
      })),
      workspaceId: deps.workspaceId,
    };
  } catch (error) {
    log('execAgent: failed to freeze credential facts: %O', error);
    return undefined;
  }
};

/**
 * Manifests carry each connector's access token for the whole run, so refresh
 * expired OAuth tokens first. Rotated credentials are persisted encrypted,
 * which needs the gatekeeper; without one, keep the stored tokens.
 */
const refreshConnectorTokens = async (
  deps: ToolDiscoveryDeps,
  gateKeeper: KeyVaultsGateKeeper | undefined,
  connectors: DecryptedConnector[],
  onTimeout: () => void,
): Promise<DecryptedConnector[]> => {
  if (!gateKeeper || connectors.length === 0) return connectors;
  return refreshExpiredConnectorTokens(
    connectors,
    new ConnectorModel(deps.db, deps.userId, deps.workspaceId, gateKeeper),
    { onTimeout },
  );
};

/** Base marketplace OAuth rows require installation; agent-owned copies are independent. */
const filterInstalledMarketplaceConnectors = (
  connectors: DecryptedConnector[],
  installedIds: Set<string>,
) =>
  connectors.filter(
    (connector) =>
      !!connector.agentId ||
      connector.sourceType !== 'marketplace' ||
      !connector.mcpServerUrl ||
      installedIds.has(connector.identifier),
  );

const readConnectors = async (
  deps: ToolDiscoveryDeps,
  ctx: ToolReadsContext,
  installedPluginIds: Promise<Set<string>>,
) => {
  const { candidateIds, resolvedAgentId } = ctx;
  let connectorGateKeeper: KeyVaultsGateKeeper | undefined;
  try {
    connectorGateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
  } catch (err) {
    log('execAgent: failed to init gatekeeper for connector credentials: %O', err);
  }

  return traceDiscoveryStage('connectors', async (span) => {
    let refreshTimeouts = 0;
    const onRefreshTimeout = () => {
      refreshTimeouts += 1;
    };
    const [resolved, installedIds] = await Promise.all([
      candidateIds.length > 0
        ? deps.connectorModel.resolveByIdentifiers(
            candidateIds,
            resolvedAgentId,
            connectorGateKeeper,
          )
        : [],
      installedPluginIds,
    ]);
    // OAuth can connect after installation was canceled. A connected row alone
    // must not make an unfinished marketplace install callable by a server run.
    const connectors = filterInstalledMarketplaceConnectors(resolved, installedIds);

    // Only connectors WITH a real MCP endpoint (mcpServerUrl or stdio) can replace plugins in the
    // manifest. Connectors WITHOUT an endpoint (e.g. Lobehub/Composio OAuth skills synced via
    // syncToolsFromClient) must continue using their original plugin executor path — otherwise
    // after humanIntervention approval the runtime tries to call mcpServerUrl='' and returns empty.
    const connectorsMcp = await refreshConnectorTokens(
      deps,
      connectorGateKeeper,
      connectors.filter((c) => c.mcpServerUrl || c.mcpConnectionType === 'stdio'),
      onRefreshTimeout,
    );

    // Fetch ALL tools for all real-MCP connectors (including disabled tools) so that
    // buildConnectorManifests can show blocking descriptions for disabled tools.
    // The runtime hot-path still uses queryByConnectorIds (non-disabled only) elsewhere.
    const connectorTools =
      connectorsMcp.length > 0
        ? await deps.connectorToolModel.queryAllByConnectorIds(connectorsMcp.map((c) => c.id))
        : [];

    const discoverable = await readDiscoverableConnectors(
      deps,
      ctx,
      connectorGateKeeper,
      onRefreshTimeout,
      installedIds,
    );
    markDegradedStage(span, refreshTimeouts, 'connector token refreshes');

    return {
      connectorGateKeeper,
      connectors,
      connectorsMcp,
      connectorTools,
      discoverableConnectorManifests: discoverable.manifests,
      discoverableConnectorsMcp: discoverable.connectorsMcp,
      discoverableConnectorTools: discoverable.tools,
    };
  });
};

/**
 * Connectors the agent has not pinned — `auto` in the three-state plugin
 * config, which is simply "absent from `plugins`". A custom MCP is stored as
 * a connector, so without this source an unpinned one is resolvable only on
 * the turn that @-mentions it: the next turn's activator answers
 * "Not found" and the model's direct call is rejected as an unknown name.
 * Like installed plugins they are discoverable but never enabled.
 *
 * A share run resolves only the connectors the share grants, by identifier:
 * `resolveAll` would decrypt every creator connector for a visitor turn.
 * Degrades to nothing on failure — widening discovery must not fail the run.
 */
const readDiscoverableConnectors = async (
  deps: ToolDiscoveryDeps,
  ctx: ToolReadsContext,
  gateKeeper: KeyVaultsGateKeeper | undefined,
  onRefreshTimeout: () => void,
  installedIds: Set<string>,
): Promise<{
  connectorsMcp: DecryptedConnector[];
  manifests: LobeToolManifest[];
  tools: UserConnectorToolItem[];
}> => {
  const none = { connectorsMcp: [], manifests: [], tools: [] };
  if (ctx.exclusivePluginIds || ctx.isGoalTurn) return none;
  try {
    const candidates = new Set(ctx.candidateIds);
    let resolved: DecryptedConnector[];
    if (ctx.shareGrantedExtensionIds) {
      const grantedUnpinnedIds = [...ctx.shareGrantedExtensionIds].filter(
        (identifier) => !candidates.has(identifier),
      );
      if (grantedUnpinnedIds.length === 0) return none;
      resolved = await deps.connectorModel.resolveByIdentifiers(
        grantedUnpinnedIds,
        ctx.resolvedAgentId,
        gateKeeper,
      );
    } else {
      resolved = await deps.connectorModel.resolveAll(ctx.resolvedAgentId, gateKeeper);
    }
    const connectorsMcp = filterInstalledMarketplaceConnectors(resolved, installedIds).filter(
      (c) => !candidates.has(c.identifier) && (c.mcpServerUrl || c.mcpConnectionType === 'stdio'),
    );
    if (connectorsMcp.length === 0) return none;

    const tools = await deps.connectorToolModel.queryAllByConnectorIds(
      connectorsMcp.map((c) => c.id),
    );
    const refreshed = await refreshConnectorTokens(
      deps,
      gateKeeper,
      connectorsMcp,
      onRefreshTimeout,
    );
    return {
      connectorsMcp: refreshed,
      manifests: buildConnectorManifests(refreshed, tools) as LobeToolManifest[],
      tools,
    };
  } catch (error) {
    log('execAgent: failed to read discoverable connectors: %O', error);
    return none;
  }
};

const readLobehubSkillManifests = async (
  deps: ToolDiscoveryDeps,
  ctx: ToolReadsContext,
): Promise<LobeToolManifest[]> => {
  // A share run lists tools only for granted providers; with none granted
  // the Market is not asked about the creator's connections at all.
  const providerIds = ctx.shareGrantedExtensionIds ? [...ctx.shareGrantedExtensionIds] : undefined;
  if (providerIds?.length === 0) return [];
  try {
    const marketService = await deps.getMarketService();
    return await traceDiscoveryStage('lobehub_skills', async (span) => {
      // The service degrades to fewer (or zero) manifests instead of
      // throwing, so count what it absorbed — otherwise a Market timeout
      // looks exactly like a user with no connected skills.
      let failureCount = 0;
      const manifests = await marketService.getLobehubSkillManifests({
        onError: () => {
          failureCount += 1;
        },
        providerIds,
      });
      span.setAttribute('lobehub.tool_discovery.manifest_count', manifests.length);
      markDegradedStage(span, failureCount, 'skill discovery requests');
      return manifests;
    });
  } catch (error) {
    log('execAgent: failed to fetch lobehub skill manifests: %O', error);
    return [];
  }
};

const readDevicePool = async (
  deps: ToolDiscoveryDeps,
  ctx: ToolReadsContext,
): Promise<DeviceAttachment[]> => {
  const { agentConfig, requestedDeviceId } = ctx;
  if (!deviceGateway.isConfigured) return [];
  try {
    // Personal pool ∪ the current workspace pool, DB rows ⊕ gateway online,
    // tagged with `scope` and the user-set `friendlyName` alias (see
    // `getScopedOnlineDevices`) so the systemRole snapshot lets the model
    // tell a personal machine apart from its workspace-enrolled counterpart
    // (same physical machine under both principals). Keep only live devices:
    // downstream `onlineDeviceIds` / `deviceOnline` treat this list as the
    // online set.
    let devices = (
      await traceDiscoveryStage('online_devices', () =>
        getScopedOnlineDevices(deps.db, deps.userId, deps.workspaceId),
      )
    ).filter((d) => d.online);

    // A workspace run that targets one of the caller's PERSONAL devices
    // needs that device visible in this run's pool — otherwise
    // `resolveExecutionPlan` treats it as offline (`bound-device-offline`)
    // and the run stays unrouted. The workspace pool never includes
    // personal devices by design (`getScopedOnlineDevices` enforces the
    // strict scope), so union the specific personal device in here. The
    // device is dispatchable because the gateway routes it by
    // `(userId, deviceId)` — the caller owns it.
    //
    // Candidates mirror the ids `resolveExecutionPlan` routes by:
    // - `agencyConfig.boundDeviceId`: the per-user override written by the
    //   `local` code path in `useSelectExecutionTarget`;
    // - `requestedDeviceId`: the desktop's own id sent with a `local` run
    //   (or the topic's pinned device, folded in by `turnSetup`). Without
    //   it, an agent whose stored target is `local` but which has no
    //   override is told the user's online desktop is offline. A `fixed`
    //   selection policy ignores it, as the resolver does.
    const isFixedSelection = agentConfig.agencyConfig?.executionTargetSelectionPolicy === 'fixed';
    const personalCandidateIds = [
      ...new Set(
        [
          agentConfig.agencyConfig?.boundDeviceId,
          isFixedSelection ? undefined : requestedDeviceId,
        ].filter((id): id is string => !!id && !devices.some((d) => d.deviceId === id)),
      ),
    ];
    if (deps.workspaceId && personalCandidateIds.length > 0) {
      const personalPool = await getScopedOnlineDevices(deps.db, deps.userId).catch(
        () => [] as DeviceAttachment[],
      );
      const personalMatches = personalPool.filter(
        (d) => d.online && personalCandidateIds.includes(d.deviceId),
      );
      if (personalMatches.length > 0) {
        devices = [...devices, ...personalMatches];
        log(
          'execAgent: augmented device pool with caller personal device(s) %o',
          personalMatches.map((d) => d.deviceId),
        );
      }
    }
    log('execAgent: found %d online device(s)', devices.length);
    return devices;
  } catch (error) {
    log('execAgent: failed to query device list: %O', error);
    return [];
  }
};

const readAttachedFileTypes = async (
  deps: ToolDiscoveryDeps,
  ctx: ToolReadsContext,
): Promise<string[]> => {
  const { attachedFileIds, shareGate } = ctx;
  if (!attachedFileIds || attachedFileIds.length === 0) return [];
  const fileModel = new FileModel(deps.db, deps.userId, deps.workspaceId);
  const uniqueFileIds = Array.from(new Set(attachedFileIds));
  const fileRecords = await traceDiscoveryStage('attached_files', () =>
    fileModel.findByIds(
      uniqueFileIds,
      shareGate ? agentShareFileAccessScope(shareGate) : ordinaryFileAccessScope,
    ),
  );
  return fileRecords.map((file) => file.fileType || '');
};

/**
 * Whether this turn can send any file as a truncated preview (see `previewLongFileContent`):
 * an enabled agent file over the inline limit, or a parsed attachment of this turn or topic
 * longer than a preview. Attachments under the inline limit are still previewed once the
 * request's attachment budget is spent (`planAttachmentPreviews`), which is only known per step,
 * so any attachment a preview would shorten enables the tool.
 * Enables the attachments tool in the modes whose rules include it (agent / chat). The preview
 * only names `readAttachment` when the final tool set carries it (see `MessagesEngine`), so
 * custom / exclusive tool turns and share visitors fall back to a plain preview.
 */
const readHasOversizedFiles = async (
  deps: ToolDiscoveryDeps,
  ctx: ToolReadsContext,
): Promise<boolean> => {
  const { agentConfig, attachedFileIds, topicId } = ctx;
  const hasOversizedAgentFile = agentConfig.files?.some(
    (file: { content?: string | null; enabled?: boolean | null; originalCharCount?: number }) =>
      file.enabled === true &&
      isOversizedFileContent(file.content?.length ?? 0, file.originalCharCount),
  );
  if (hasOversizedAgentFile) return true;
  if (!topicId && !attachedFileIds?.length) return false;

  return traceDiscoveryStage('oversized_files', () =>
    new DocumentModel(deps.db, deps.userId, deps.workspaceId).hasFileDocumentsOverChars({
      fileIds: attachedFileIds,
      minChars: FILE_PREVIEW_CHARS,
      topicId,
    }),
  );
};

/**
 * Whether the executing agent owns at least one live identity account. This
 * is the fact the tool rules read to decide whether the agent-account tool
 * ships this turn: the addresses and inbox reach the model as context, so the
 * tool is enabled only when there is something for it to act on. Non-critical
 * — a failed read simply leaves the tool out.
 */
const readHasIdentityAccount = async (
  deps: ToolDiscoveryDeps,
  ctx: ToolReadsContext,
): Promise<boolean> => {
  const accounts = await new AgentAccountModel(
    deps.db,
    deps.userId,
    undefined,
    deps.workspaceId,
  ).query({ agentId: ctx.resolvedAgentId, liveOnly: true });

  return accounts.length > 0;
};

/**
 * Every other read this send needs, started together. They hit different
 * backends — Postgres rows, the Market's live skill discovery, the device
 * gateway. Connector visibility uses the same installed-plugin snapshot; the
 * reads still start together. Each keeps the degrade-to-empty
 * behavior it had when it ran in sequence; only the plugin list still fails
 * the run, because a run with no plugins is not the same run.
 */
export const startToolReads = (deps: ToolDiscoveryDeps, ctx: ToolReadsContext) => {
  const installedPlugins = started(
    traceDiscoveryStage('installed_plugins', () => deps.pluginModel.query()),
  );
  const installedPluginIds = started(
    installedPlugins.then((plugins) => new Set(plugins.map((plugin) => plugin.identifier))),
  );
  return {
    // The fallbacks sit OUTSIDE `traceDiscoveryStage` on purpose: the wrapper
    // only marks a span errored when its callback throws, so absorbing the
    // failure inside it would report a healthy stage for a failed read.
    agentDocuments: started(
      traceDiscoveryStage('agent_documents', () =>
        deps.agentDocumentsService.hasDocuments(ctx.resolvedAgentId),
      ).catch(() => false), // non-critical
    ),
    attachedFileTypes: started(readAttachedFileTypes(deps, ctx)),
    oversizedFiles: started(readHasOversizedFiles(deps, ctx).catch(() => false)), // non-critical
    hasIdentityAccount: started(readHasIdentityAccount(deps, ctx).catch(() => false)), // non-critical
    // A share run reads only the granted Composio connections, and skips the
    // read when nothing is granted.
    composioManifests: started(
      (ctx.shareGrantedExtensionIds?.size === 0
        ? Promise.resolve<LobeToolManifest[]>([])
        : traceDiscoveryStage('composio', () =>
            deps.composioService.getComposioManifests(
              ctx.resolvedAgentId,
              ctx.shareGrantedExtensionIds && { identifiers: [...ctx.shareGrantedExtensionIds] },
            ),
          )
      ).catch((error) => {
        log('execAgent: failed to fetch composio manifests: %O', error);
        return [] as LobeToolManifest[];
      }),
    ),
    connectors: started(readConnectors(deps, ctx, installedPluginIds)),
    devicePool: started(readDevicePool(deps, ctx)),
    installedPlugins,
    lobehubSkillManifests: started(readLobehubSkillManifests(deps, ctx)),
    projectScope: started(readProjectToolScope(deps, ctx)), // degrades to no project
  };
};

export type ToolReads = ReturnType<typeof startToolReads>;

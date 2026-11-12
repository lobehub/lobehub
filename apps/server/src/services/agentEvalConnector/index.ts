import { createHash } from 'node:crypto';

import type { LobeChatDatabase } from '@lobechat/database';
import { ssrfSafeFetch } from '@lobechat/ssrf-safe-fetch';
import type {
  EvalConnectorBindings,
  EvalConnectorSnapshots,
  EvalToolManifests,
  ToolManifest,
} from '@lobechat/types';
import { evalToolManifestSchema, parseEnvironmentConnectionId } from '@lobechat/types';
import { isRecord } from '@lobechat/utils/object';
import debug from 'debug';
import pMap from 'p-map';

import { ConnectorModel, type PublicConnectorRecord } from '@/database/models/connector';
import { ConnectorToolModel } from '@/database/models/connectorTool';
import {
  AgentEvalEnvironmentConnectionRepo,
  type StoredEnvironmentConnection,
} from '@/database/repositories/agentEvalEnvironmentConnection';
import type { ConnectorCredentials } from '@/database/schemas';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { EVAL_INFRASTRUCTURE_TOOLS } from '@/server/services/agentEvalRun/constants';
import {
  buildConnectorMcpParams,
  buildHttpAuthFromCredentials,
  syncConnectorToolsById,
} from '@/server/services/connector/sync';
import { ensureFreshConnectorToken } from '@/server/services/connector/tokens';
import { mcpService } from '@/server/services/mcp';

const log = debug('lobe-server:agent-eval-connector');

export class EvalConnectorBindingError extends Error {
  readonly code = 'BAD_REQUEST' as const;
}

const unavailable = () =>
  new EvalConnectorBindingError(
    'The selected mock connection is unavailable. Choose an enabled HTTP connection in this Dataset that is not assigned to an Agent.',
  );

/** Persisted runs must name one Dataset before any connection can be resolved. */
export const getEvalConnectorDatasetId = (snapshots: EvalConnectorSnapshots): string => {
  const bindings = Object.values(snapshots);
  const datasetId = bindings[0]?.datasetId;
  if (!datasetId || bindings.some((binding) => binding.datasetId !== datasetId)) {
    throw new EvalConnectorBindingError(
      'This run has no consistent frozen Dataset connection scope. Create a new experiment.',
    );
  }
  return datasetId;
};

const bindingLabel = (identifier: string, connectorId: string) => {
  const id = /^[\w-]{1,128}$/.test(connectorId) ? connectorId : 'unavailable';
  const alias = /^[\w.-]{1,128}$/.test(identifier) ? ` (alias "${identifier}")` : '';
  return `Mock connection "${id}"${alias}`;
};

const isEligible = (connector: PublicConnectorRecord | null): connector is PublicConnectorRecord =>
  !!connector &&
  connector.isEnabled &&
  connector.mcpConnectionType === 'http' &&
  !!connector.mcpServerUrl &&
  !connector.agentId &&
  !connector.mountedByAgentId;

/** A connection stored in an Environment, in the shape connector checks read. */
const storedRecord = (stored: StoredEnvironmentConnection): PublicConnectorRecord => ({
  agentId: null,
  avatar: null,
  createdAt: new Date(0),
  description: null,
  hasCredentials: !!stored.connection.credentials,
  id: stored.connectorId,
  identifier: stored.service,
  isEnabled: true,
  mcpConnectionType: 'http',
  mcpServerUrl: stored.connection.url,
  mountedByAgentId: null,
  name: stored.connection.name ?? stored.service,
  sourceType: 'custom',
  status: 'connected',
  updatedAt: new Date(0),
  userId: '',
});

const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
};

/** Only the selected connection's own MCP route may supply its forwarding destination. */
export const getLobeBenchForwardingEndpoint = (serverUrl: string): string => {
  let url: URL;
  try {
    url = new URL(serverUrl);
  } catch {
    throw new EvalConnectorBindingError('The mock connection has an invalid URL.');
  }
  const route = url.pathname.match(/^(.*)\/mcp\/([^/]+)\/([^/]+)\/?$/);
  if (!route || url.username || url.password || url.search || url.hash) {
    throw new EvalConnectorBindingError(
      'A LobeBench connection must use its /mcp/<dataset>/<service> discovery URL without credentials or query parameters.',
    );
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new EvalConnectorBindingError('The mock connection must use HTTP or HTTPS.');
  }
  url.pathname = `${route[1]}/tool-exec/${route[2]}/${route[3]}/exec`;
  return url.toString();
};

/** Evaluation-specific binding uses the connector UUID, never same-name resolution. */
export class AgentEvalConnectorService {
  private readonly connectorModel: ConnectorModel;
  private readonly storedConnections: AgentEvalEnvironmentConnectionRepo;
  private readonly toolModel: ConnectorToolModel;

  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly datasetId: string,
    private readonly workspaceId?: string,
  ) {
    if (!datasetId) throw unavailable();
    this.connectorModel = ConnectorModel.forEvaluation(db, userId, datasetId, workspaceId);
    this.toolModel = ConnectorToolModel.forEvaluation(db, userId, datasetId, workspaceId);
    this.storedConnections = new AgentEvalEnvironmentConnectionRepo(db, userId, workspaceId);
  }

  /** A connection stored in an Environment this Dataset uses, by its `env:` id. */
  private findStored = (connectorId: string) =>
    parseEnvironmentConnectionId(connectorId)
      ? this.storedConnections.find(this.datasetId, connectorId)
      : Promise.resolve(undefined);

  /** Connection metadata from a connector row or from an Environment, never credentials. */
  private async findPublic(connectorId: string): Promise<PublicConnectorRecord | null> {
    if (!parseEnvironmentConnectionId(connectorId))
      return this.connectorModel.findPublicById(connectorId);
    const stored = await this.findStored(connectorId);
    return stored ? storedRecord(stored) : null;
  }

  /** Request headers carrying a stored connection's decrypted credentials. */
  private async storedHeaders(stored: StoredEnvironmentConnection) {
    let credentials: ConnectorCredentials | null = null;
    if (stored.connection.credentials) {
      const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
      const { plaintext } = await gateKeeper.decrypt(stored.connection.credentials);
      credentials = JSON.parse(plaintext) as ConnectorCredentials;
    }
    const { auth, headers } = buildHttpAuthFromCredentials(credentials);
    return this.authHeaders({
      auth,
      headers,
      name: stored.service,
      type: 'http',
      url: stored.connection.url,
    });
  }

  /** The LobeBench adapter authenticates /sessions/* before lookup: 200 or 404 proves the credentials. */
  private async probeLobeBench(serverUrl: string, headers: Headers) {
    const endpoint = new URL(getLobeBenchForwardingEndpoint(serverUrl));
    endpoint.pathname = endpoint.pathname.replace(
      /\/tool-exec\/[^/]+\/[^/]+\/exec$/,
      `/sessions/eval-connection-check-${crypto.randomUUID()}`,
    );
    const response = await ssrfSafeFetch(endpoint.toString(), {
      headers,
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
    });
    await response.body?.cancel().catch(() => {});
    if (![200, 404].includes(response.status)) {
      throw new EvalConnectorBindingError(
        `Mock connection authentication failed (HTTP ${response.status}).`,
      );
    }
  }

  async listAvailableConnectors() {
    const rows = await this.connectorModel.queryPublic();
    return rows.filter(isEligible).map(({ id, identifier, name }) => ({ id, identifier, name }));
  }

  // Other native tool aliases are intentionally mockable through the hook;
  // only evaluation infrastructure must keep its real implementation.
  async validateBindings(bindings: EvalConnectorBindings = {}) {
    for (const [identifier, binding] of Object.entries(bindings)) {
      if (!identifier || EVAL_INFRASTRUCTURE_TOOLS.includes(identifier)) {
        throw new EvalConnectorBindingError(
          'This tool identifier cannot be bound to a mock connection.',
        );
      }
      const connector = await this.findPublic(binding.connectorId);
      if (!isEligible(connector)) throw unavailable();
      if (parseEnvironmentConnectionId(binding.connectorId) && binding.transport !== 'lobe-bench') {
        throw new EvalConnectorBindingError(
          'A connection stored in an Environment must use the LobeBench transport.',
        );
      }
      if (binding.transport === 'lobe-bench') {
        getLobeBenchForwardingEndpoint(connector.mcpServerUrl!);
      }
    }
  }

  async resolveBindings(
    bindings: EvalConnectorBindings = {},
    expected?: EvalConnectorSnapshots,
    contracts?: EvalToolManifests,
  ) {
    if (
      expected &&
      Object.keys(expected).length &&
      getEvalConnectorDatasetId(expected) !== this.datasetId
    )
      throw unavailable();
    await this.validateBindings(bindings);
    const snapshots: EvalConnectorSnapshots = Object.create(null);
    const manifests: ToolManifest[] = [];
    if (expected && stable(Object.keys(expected).sort()) !== stable(Object.keys(bindings).sort())) {
      throw new EvalConnectorBindingError('The mock bindings changed. Create a new experiment.');
    }
    for (const [identifier, binding] of Object.entries(bindings)) {
      const connector = await this.findPublic(binding.connectorId);
      if (!isEligible(connector)) throw unavailable();
      const storedConnection = await this.findStored(connector.id);
      const stored = !!storedConnection;
      const transport = binding.transport ?? 'mcp';
      // A stored connection carries its Environment's frozen contract with it.
      const original =
        contracts?.[identifier] ??
        expected?.[identifier]?.manifest ??
        storedConnection?.toolManifest;
      if ((expected || contracts || stored) && !original) {
        throw new EvalConnectorBindingError(
          'This run has no original tool contract. Add the contract to its Environment and create a new experiment.',
        );
      }
      const manifest = original ? evalToolManifestSchema.parse(original) : undefined;
      if (manifest && manifest.identifier !== identifier) {
        throw new EvalConnectorBindingError('The tool contract does not match its binding.');
      }
      // A stored connection has no discovery cache: its frozen contract is its tool list.
      const tools =
        stored && manifest
          ? manifest.api.map((api) => ({
              description: api.description ?? null,
              inputSchema: api.parameters,
              permission: 'auto',
              toolName: api.name,
            }))
          : await this.toolModel.queryByConnector(connector.id);
      const fingerprint = createHash('sha256')
        .update(
          stable({
            ...(manifest && { manifest }),
            connectorId: connector.id,
            datasetId: this.datasetId,
            mcpServerUrl: connector.mcpServerUrl,
            tools: tools
              .map(({ description, inputSchema, permission, toolName }) => ({
                description,
                inputSchema,
                permission,
                toolName,
              }))
              .sort((a, b) => a.toolName.localeCompare(b.toolName)),
            transport,
          }),
        )
        .digest('hex');
      const snapshot = {
        connectorId: connector.id,
        datasetId: this.datasetId,
        fingerprint,
        transport,
        ...(manifest && { manifest }),
      };
      if (expected && stable(expected[identifier]) !== stable(snapshot)) {
        throw new EvalConnectorBindingError(
          `${bindingLabel(identifier, connector.id)}: The mock connection or its tools changed. Create a new experiment with the current connection.`,
        );
      }
      const permitted = new Set(
        tools.filter((tool) => tool.permission === 'auto').map((tool) => tool.toolName),
      );
      if (!permitted.size) {
        throw new EvalConnectorBindingError(
          `${bindingLabel(identifier, connector.id)}: The connection has no automatically permitted tools.`,
        );
      }
      if (manifest?.api.some((api) => !permitted.has(api.name))) {
        throw new EvalConnectorBindingError(
          `${bindingLabel(identifier, connector.id)}: The connection does not provide all original tools with automatically permitted access.`,
        );
      }
      snapshots[identifier] = snapshot;
      // Deliberately no mcpParams: operation state may retain this manifest.
      if (manifest) manifests.push(manifest as ToolManifest);
    }
    return { manifests, snapshots };
  }

  /**
   * Share discovery only within this preflight, while validating every case's
   * aliases. `contracts[i]` are group i's own tool contracts: a connection stored
   * in an Environment is checked against the contract of the case that brought
   * it, which may live in the case rather than in the shared Environment.
   */
  async checkBindingGroups(
    groups: EvalConnectorBindings[],
    contracts: Array<EvalToolManifests | undefined> = [],
  ) {
    const startedAt = performance.now();
    const connectionCount = new Set(
      groups.flatMap((bindings) => Object.values(bindings).map(({ connectorId }) => connectorId)),
    ).size;
    const connections = new Map<
      string,
      Map<string, { bindings: EvalConnectorBindings; contracts?: EvalToolManifests }>
    >();
    let status = 'failure';
    try {
      for (const [index, bindings] of groups.entries()) {
        await this.validateBindings(bindings);
        for (const [identifier, binding] of Object.entries(bindings)) {
          let transports = connections.get(binding.connectorId);
          if (!transports) {
            transports = new Map();
            connections.set(binding.connectorId, transports);
          }
          const transport = binding.transport ?? 'mcp';
          // Only a stored connection takes its contract from the case: a connector
          // row is checked against its own discovered tools, as before.
          const contract = parseEnvironmentConnectionId(binding.connectorId)
            ? contracts[index]?.[identifier]
            : undefined;
          if (!transports.has(transport))
            transports.set(transport, {
              bindings: { [identifier]: binding },
              ...(contract && { contracts: { [identifier]: contract } }),
            });
        }
      }
      await pMap(
        connections.values(),
        async (transports) => {
          // Different transports still sync the same connector's tools. Serialize
          // them to avoid competing upserts, but check each protocol independently.
          for (const { bindings, contracts } of transports.values())
            await this.checkBindings(bindings, contracts);
        },
        { concurrency: 4 },
      );
      status = 'success';
    } finally {
      log(
        'preflight batch groups=%d connections=%d elapsedMs=%d status=%s',
        groups.length,
        connectionCount,
        Math.round(performance.now() - startedAt),
        status,
      );
    }
  }

  /** Authenticated discovery is run before creation, not inferred from cached health. */
  async checkBindings(bindings: EvalConnectorBindings = {}, contracts?: EvalToolManifests) {
    await this.validateBindings(bindings);
    if (Object.keys(bindings).length === 0)
      return this.resolveBindings(bindings, undefined, contracts);
    const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
    const connectorModel = ConnectorModel.forEvaluation(
      this.db,
      this.userId,
      this.datasetId,
      this.workspaceId,
      gateKeeper,
    );
    for (const [identifier, binding] of Object.entries(bindings)) {
      try {
        if (parseEnvironmentConnectionId(binding.connectorId)) {
          const stored = await this.findStored(binding.connectorId);
          if (!stored) throw unavailable();
          await this.probeLobeBench(stored.connection.url, await this.storedHeaders(stored));
          continue;
        }
        const publicRow = await this.connectorModel.findPublicById(binding.connectorId);
        const credentialRow = await connectorModel.findById(binding.connectorId);
        if (
          !isEligible(publicRow) ||
          !credentialRow ||
          (publicRow.hasCredentials && !credentialRow.credentials)
        )
          throw unavailable();
        await syncConnectorToolsById(
          binding.connectorId,
          {
            connectorModel,
            connectorToolModel: this.toolModel,
          },
          { pruneMissingAutoTools: true },
        );
        // The canonical LobeBench adapter authenticates /sessions/* before lookup.
        // Its missing-session 404 therefore verifies auth; arbitrary MCP servers
        // must use the standard adapter instead of claiming this protocol.
        if (binding.transport === 'lobe-bench') {
          const connector = await connectorModel.findById(binding.connectorId);
          if (!connector?.mcpServerUrl) throw unavailable();
          await this.probeLobeBench(
            connector.mcpServerUrl,
            this.authHeaders(buildConnectorMcpParams(connector)),
          );
        }
      } catch (error) {
        log(
          'preflight failed connector=%s errorType=%s',
          binding.connectorId,
          error instanceof Error ? error.name : typeof error,
        );
        // Report the stable connection and its representative alias, never the
        // upstream message (which may contain credentials or private URLs).
        const reason =
          error instanceof EvalConnectorBindingError
            ? error.message
            : error instanceof Error && error.name === 'TimeoutError'
              ? 'Could not verify the mock connection: the request timed out.'
              : error instanceof Error && error.name === 'AbortError'
                ? 'Could not verify the mock connection: the request was interrupted.'
                : 'Could not verify the mock connection. Check its address, credentials and tool access.';
        throw new EvalConnectorBindingError(
          `${bindingLabel(identifier, binding.connectorId)}: ${reason}`,
        );
      }
    }
    return this.resolveBindings(bindings, undefined, contracts);
  }

  /** The stored connections this Dataset's Environments hold. */
  listStoredConnections() {
    return this.storedConnections.listForDataset(this.datasetId);
  }

  /** Authenticates a stored connection against its mock; reports the size of its frozen contract. */
  async testStoredConnection(connectorId: string) {
    const stored = await this.findStored(connectorId);
    if (!stored) throw unavailable();
    await this.probeLobeBench(stored.connection.url, await this.storedHeaders(stored));
    return { toolCount: stored.toolManifest?.api.length ?? 0 };
  }

  private authHeaders(clientParams: ReturnType<typeof buildConnectorMcpParams>) {
    const headers = new Headers('headers' in clientParams ? clientParams.headers : undefined);
    const auth = 'auth' in clientParams ? clientParams.auth : undefined;
    if (auth?.type === 'bearer') headers.set('Authorization', `Bearer ${auth.token}`);
    if (auth?.type === 'oauth2' && auth.accessToken) {
      headers.set('Authorization', `Bearer ${auth.accessToken}`);
    }
    return headers;
  }

  async execute(
    identifier: string,
    bindings: EvalConnectorSnapshots,
    params: {
      apiName: string;
      args: string;
      attemptId?: string;
      callIndex?: number;
      caseId?: string;
      operationId?: string;
      stepIndex?: number;
    },
  ) {
    if (getEvalConnectorDatasetId(bindings) !== this.datasetId) throw unavailable();
    const binding = Object.hasOwn(bindings, identifier) ? bindings[identifier] : undefined;
    if (!binding) throw unavailable();
    const approved = await this.findPublic(binding.connectorId);
    if (!isEligible(approved)) throw unavailable();
    const { manifests } = await this.resolveBindings(
      { [identifier]: binding },
      { [identifier]: binding },
    );
    if (!manifests[0].api.some((tool) => tool.name === params.apiName)) {
      throw new EvalConnectorBindingError('This tool is not permitted for unattended evaluation.');
    }
    if (parseEnvironmentConnectionId(binding.connectorId)) {
      const stored = await this.findStored(binding.connectorId);
      if (!stored || stored.connection.url !== approved.mcpServerUrl) throw unavailable();
      return this.forwardLobeBench(stored.connection.url, await this.storedHeaders(stored), params);
    }
    const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
    const credentialModel = ConnectorModel.forEvaluation(
      this.db,
      this.userId,
      this.datasetId,
      this.workspaceId,
      gateKeeper,
    );
    let connector = await credentialModel.findById(binding.connectorId);
    if (
      !connector ||
      !connector.isEnabled ||
      connector.agentId ||
      connector.metadata?.mountedByAgentId ||
      connector.mcpConnectionType !== 'http' ||
      connector.mcpServerUrl !== approved.mcpServerUrl ||
      (approved.hasCredentials && !connector.credentials)
    ) {
      throw unavailable();
    }
    connector = await ensureFreshConnectorToken(connector, credentialModel);
    const clientParams = buildConnectorMcpParams(connector);
    if (binding.transport !== 'lobe-bench') {
      return mcpService.callTool({ argsStr: params.args, clientParams, toolName: params.apiName });
    }

    if (!connector.mcpServerUrl) throw unavailable();
    return this.forwardLobeBench(connector.mcpServerUrl, this.authHeaders(clientParams), params);
  }

  /** One tool call forwarded to a LobeBench mock's /tool-exec route for this case attempt. */
  private async forwardLobeBench(
    serverUrl: string,
    headers: Headers,
    params: {
      apiName: string;
      args: string;
      attemptId?: string;
      callIndex?: number;
      caseId?: string;
      operationId?: string;
      stepIndex?: number;
    },
  ) {
    if (!params.caseId || !params.attemptId) {
      throw new EvalConnectorBindingError(
        'The LobeBench mock requires a case and attempt identity.',
      );
    }
    const endpoint = getLobeBenchForwardingEndpoint(serverUrl);
    headers.set('Content-Type', 'application/json');
    const response = await ssrfSafeFetch(endpoint, {
      body: JSON.stringify({
        data: {
          apiName: params.apiName,
          args: params.args,
          identifier: decodeURIComponent(
            new URL(serverUrl).pathname.replace(/\/$/, '').split('/').at(-1)!,
          ),
        },
        metadata: {
          attemptId: params.attemptId,
          callIndex: params.callIndex,
          caseId: params.caseId,
          operationId: params.operationId,
          stepIndex: params.stepIndex,
        },
        type: 'toolCall',
      }),
      headers,
      method: 'POST',
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new EvalConnectorBindingError(`The mock connection returned HTTP ${response.status}.`);
    }
    const body: unknown = await response.json();
    if (
      !isRecord(body) ||
      body.success !== true ||
      !isRecord(body.data) ||
      typeof body.data.content !== 'string' ||
      typeof body.data.success !== 'boolean'
    ) {
      throw new EvalConnectorBindingError('The mock connection returned an invalid tool result.');
    }
    return { content: body.data.content, success: body.data.success };
  }
}

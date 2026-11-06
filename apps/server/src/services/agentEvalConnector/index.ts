import { createHash } from 'node:crypto';

import type { LobeChatDatabase } from '@lobechat/database';
import { ssrfSafeFetch } from '@lobechat/ssrf-safe-fetch';
import type {
  EvalConnectorBindings,
  EvalConnectorSnapshots,
  EvalToolManifests,
  ToolManifest,
} from '@lobechat/types';
import { evalToolManifestSchema } from '@lobechat/types';
import { isRecord } from '@lobechat/utils/object';
import debug from 'debug';
import pMap from 'p-map';

import { ConnectorModel, type PublicConnectorRecord } from '@/database/models/connector';
import { ConnectorToolModel } from '@/database/models/connectorTool';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { EVAL_INFRASTRUCTURE_TOOLS } from '@/server/services/agentEvalRun/constants';
import { buildConnectorMcpParams, syncConnectorToolsById } from '@/server/services/connector/sync';
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
      const connector = await this.connectorModel.findPublicById(binding.connectorId);
      if (!isEligible(connector)) throw unavailable();
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
      const connector = await this.connectorModel.findPublicById(binding.connectorId);
      if (!isEligible(connector)) throw unavailable();
      const tools = await this.toolModel.queryByConnector(connector.id);
      const transport = binding.transport ?? 'mcp';
      const original = contracts?.[identifier] ?? expected?.[identifier]?.manifest;
      if ((expected || contracts) && !original) {
        throw new EvalConnectorBindingError(
          'This run has no original tool contract. Add the contract to its Environment and create a new experiment.',
        );
      }
      const manifest = original ? evalToolManifestSchema.parse(original) : undefined;
      if (manifest && manifest.identifier !== identifier) {
        throw new EvalConnectorBindingError('The tool contract does not match its binding.');
      }
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

  /** Share discovery only within this preflight, while validating every case's aliases. */
  async checkBindingGroups(groups: EvalConnectorBindings[]) {
    const startedAt = performance.now();
    const connectionCount = new Set(
      groups.flatMap((bindings) => Object.values(bindings).map(({ connectorId }) => connectorId)),
    ).size;
    const connections = new Map<string, Map<string, EvalConnectorBindings>>();
    let status = 'failure';
    try {
      for (const bindings of groups) {
        await this.validateBindings(bindings);
        for (const [identifier, binding] of Object.entries(bindings)) {
          let transports = connections.get(binding.connectorId);
          if (!transports) {
            transports = new Map();
            connections.set(binding.connectorId, transports);
          }
          const transport = binding.transport ?? 'mcp';
          if (!transports.has(transport)) transports.set(transport, { [identifier]: binding });
        }
      }
      await pMap(
        connections.values(),
        async (transports) => {
          // Different transports still sync the same connector's tools. Serialize
          // them to avoid competing upserts, but check each protocol independently.
          for (const bindings of transports.values()) await this.checkBindings(bindings);
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
          const endpoint = new URL(getLobeBenchForwardingEndpoint(connector.mcpServerUrl));
          endpoint.pathname = endpoint.pathname.replace(
            /\/tool-exec\/[^/]+\/[^/]+\/exec$/,
            `/sessions/eval-connection-check-${crypto.randomUUID()}`,
          );
          const params = buildConnectorMcpParams(connector);
          const headers = this.authHeaders(params);
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
    const approved = await this.connectorModel.findPublicById(binding.connectorId);
    if (!isEligible(approved)) throw unavailable();
    const { manifests } = await this.resolveBindings(
      { [identifier]: binding },
      { [identifier]: binding },
    );
    if (!manifests[0].api.some((tool) => tool.name === params.apiName)) {
      throw new EvalConnectorBindingError('This tool is not permitted for unattended evaluation.');
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

    if (!params.caseId || !params.attemptId || !connector.mcpServerUrl) {
      throw new EvalConnectorBindingError(
        'The LobeBench mock requires a case and attempt identity.',
      );
    }
    const endpoint = getLobeBenchForwardingEndpoint(connector.mcpServerUrl);
    const headers = this.authHeaders(clientParams);
    headers.set('Content-Type', 'application/json');
    const response = await ssrfSafeFetch(endpoint, {
      body: JSON.stringify({
        data: {
          apiName: params.apiName,
          args: params.args,
          identifier: decodeURIComponent(
            new URL(connector.mcpServerUrl).pathname.replace(/\/$/, '').split('/').at(-1)!,
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

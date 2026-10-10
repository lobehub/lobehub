import { arrayEntity, defineReplica, type ReplicaEntityAdapter } from '@/libs/replica';

import type { AgentBoundConnector, ConnectorWithTools } from './types';

/**
 * The connector lists are not paged, so each resource holds one entry per
 * scope and every sync shares these params.
 */
export const CONNECTOR_LIST_KEY = 'all';

/**
 * Connectors of the active scope (`connectors`), read by the tool picker, the
 * connector settings page and the agent profile. A local-first replica paints
 * the persisted list on the first frame and lets the network confirm it.
 */
export const connectorsResource = defineReplica<
  Record<string, never>,
  ConnectorWithTools[],
  ConnectorWithTools[]
>({
  key: () => CONNECTOR_LIST_KEY,
  name: 'connectors',
  storage: 'indexedDB',
  version: 1,
});

/**
 * Every agent-owned connector across agents (`agentBoundConnectors`), for the
 * unified connector-settings page. Kept as its own resource because it is a
 * heavier, server-enriched projection (`listAgentBound`) than the base list.
 */
export const agentBoundConnectorsResource = defineReplica<
  Record<string, never>,
  AgentBoundConnector[],
  AgentBoundConnector[]
>({
  key: () => CONNECTOR_LIST_KEY,
  name: 'agentBoundConnectors',
  storage: 'indexedDB',
  version: 1,
});

/**
 * One agent's own connectors — owned plus mounted (`agentConnectors[agentId]`),
 * for the Agent Tools tab and the profile editor.
 */
export const agentConnectorsResource = defineReplica<{ agentId: string }, ConnectorWithTools[]>({
  key: ({ agentId }) => agentId,
  name: 'agentConnectors',
  storage: 'indexedDB',
  version: 1,
});

/** Connectors are addressed by `id` across the tool store. */
export const connectorsEntity: ReplicaEntityAdapter<ConnectorWithTools[], ConnectorWithTools> =
  arrayEntity<ConnectorWithTools>((connector) => connector.id);

export const agentBoundConnectorsEntity: ReplicaEntityAdapter<
  AgentBoundConnector[],
  AgentBoundConnector
> = arrayEntity<AgentBoundConnector>((connector) => connector.id);

/**
 * `mcpStdioConfig` is a runtime-only field of the connector rows — the server
 * ships it, but `ConnectorWithTools` doesn't declare it (consumers cast for it).
 */
interface ConnectorSecretFields {
  mcpStdioConfig?: { args?: string[]; command?: string; env?: Record<string, string> };
}

/**
 * Strip the connector secrets the list routes ship for the *edit form* before a
 * projection is persisted.
 *
 * `list` / `listByAgent` / `listAgentBound` remove `credentials` and the OIDC
 * client secret, but they spread the rest of the row through — so
 * `mcpStdioConfig.env` (the API keys / tokens an MCP stdio process is launched
 * with) and `metadata.customHeaders` (the headers an HTTP MCP endpoint is
 * called with) reach the browser. That is deliberate: `CustomConnectorModal`
 * pre-fills both from the list instead of calling `getForEdit`.
 *
 * Keeping them in memory is fine. Writing them to IndexedDB is not: persisted
 * projection rows outlive the session, are partitioned per scope but never
 * cleared on logout, and would turn an authenticated response into durable
 * plaintext secret storage. So strip them on the way to storage only — the
 * in-memory row keeps them, and the `ConnectorWithTools` type never promised
 * them anyway.
 */
export const withoutConnectorSecrets = <T extends ConnectorWithTools>(connectors: T[]): T[] =>
  connectors.map((connector) => {
    const stdio = (connector as ConnectorWithTools & ConnectorSecretFields).mcpStdioConfig;
    const metadata = connector.metadata;

    const stripStdioEnv = !!stdio?.env && Object.keys(stdio.env).length > 0;
    const stripCustomHeaders = !!metadata && 'customHeaders' in metadata;
    if (!stripStdioEnv && !stripCustomHeaders) return connector;

    const next = { ...connector };
    if (stripStdioEnv) {
      const { env: _env, ...stdioConfig } = stdio!;
      (next as ConnectorWithTools & ConnectorSecretFields).mcpStdioConfig = stdioConfig;
    }
    if (stripCustomHeaders) {
      const { customHeaders: _customHeaders, ...restMetadata } = metadata!;
      next.metadata = restMetadata;
    }
    return next;
  });

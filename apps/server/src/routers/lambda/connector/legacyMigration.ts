import { MARKETPLACE_INSTALL_COMPLETED_KEY, MARKETPLACE_TOOL_POLICIES_KEY } from '@lobechat/const';
import type { LobeTool } from '@lobechat/types';

import type { NewUserConnector } from '@/database/schemas';
import {
  ConnectorMcpConnectionType,
  ConnectorSourceType,
  ConnectorStatus,
} from '@/database/schemas';
import { buildCloudMcpManifest, cloudManifestTools } from '@/libs/mcp/cloudManifest';

type LegacyPluginRow = Pick<
  LobeTool,
  'customParams' | 'identifier' | 'manifest' | 'settings' | 'type'
>;

type MigrationResult =
  | { payload: Omit<NewUserConnector, 'userId' | 'id' | 'createdAt' | 'updatedAt'>; ok: true }
  | { ok: false; reason: 'no-endpoint' | 'no-mcp' };

const trimRecord = (input?: Record<string, string>) => {
  if (!input) return undefined;
  const entries = Object.entries(input)
    .map(([key, value]) => [key.trim(), typeof value === 'string' ? value.trim() : value] as const)
    .filter(([key, value]) => key && value !== '');
  return entries.length ? Object.fromEntries(entries) : undefined;
};

const settingsRecord = (input: unknown) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const entries = Object.entries(input as Record<string, unknown>).filter(
    ([, value]) => value !== undefined && value !== null,
  );
  if (!entries.length) return undefined;
  return Object.fromEntries(
    entries.map(([key, value]) => [key, typeof value === 'string' ? value : String(value)]),
  );
};

const PLACEHOLDER = /\{\{\s*(?:config\.)?([\w.-]+)\s*\}\}/g;

const fillPlaceholders = (
  template: string,
  values: Record<string, string> | undefined,
  encode: (value: string) => string,
  usedKeys: string[] = [],
) =>
  template.replaceAll(PLACEHOLDER, (placeholder, key: string) => {
    const value = values?.[key];
    if (value === undefined || value === '') return placeholder;
    if (!usedKeys.includes(key)) usedKeys.push(key);
    return encode(value);
  });

const renderUrlTemplate = (url: string, values?: Record<string, string>) => {
  const usedKeys: string[] = [];
  return { url: fillPlaceholders(url, values, encodeURIComponent, usedKeys), usedKeys };
};

const omitKeys = (input: Record<string, string> | undefined, keys: string[]) => {
  if (!input) return undefined;
  const omitted = Object.fromEntries(Object.entries(input).filter(([key]) => !keys.includes(key)));
  return Object.keys(omitted).length ? omitted : undefined;
};

const mergeDefined = <T extends Record<string, string> | undefined>(base: T, overlay: T) =>
  base || overlay ? { ...base, ...overlay } : undefined;

/** The approval policy a legacy marketplace manifest declared for each of its tools. */
const marketplaceToolPolicies = (plugin: LegacyPluginRow) => {
  const manifest = plugin.manifest as
    | {
        api?: unknown;
        description?: string;
        icon?: string;
        tools?: unknown;
      }
    | undefined;
  const hasTools =
    (Array.isArray(manifest?.api) && manifest.api.length > 0) ||
    (Array.isArray(manifest?.tools) && manifest.tools.length > 0);
  if (!manifest || !hasTools) return {};
  const tools = cloudManifestTools(
    buildCloudMcpManifest({
      data: manifest,
      plugin: {
        description: manifest.description,
        icon: manifest.icon,
        identifier: plugin.identifier,
      },
    }),
  );
  return Object.fromEntries(
    tools.map((tool) => [tool.toolName, tool.humanIntervention ?? null] as const),
  );
};

const validHttpUrl = (url?: string) => {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

/**
 * Convert the server-confirmed legacy plugin row into the connector row that
 * replaces it. Settings are baked into the same places a marketplace install
 * resolves them: URL placeholders for HTTP, args/env for stdio, and remaining
 * config values as headers. OAuth tokens stay server-side end to end: the
 * caller supplies only the legacy identifier, never the token.
 */
export const buildConnectorMigrationRow = (plugin: LegacyPluginRow): MigrationResult => {
  const mcp = plugin.customParams?.mcp;
  if (!mcp) return { ok: false, reason: 'no-mcp' };

  const settings = settingsRecord(plugin.settings);
  const headers = trimRecord(mcp.headers);
  // Legacy community rows often carry the market's flat manifest shape
  // (`name` / `description` / `icon`) rather than LobeChat's `meta` object.
  const manifest = plugin.manifest as
    | {
        description?: string;
        icon?: string;
        meta?: { avatar?: string; description?: string; title?: string };
        name?: string;
        version?: string;
      }
    | undefined;
  const metadata: Record<string, unknown> = Object.fromEntries(
    Object.entries({
      avatar: manifest?.meta?.avatar ?? manifest?.icon,
      description: manifest?.meta?.description ?? manifest?.description,
      migratedFromLegacyPlugin: true,
      version: manifest?.version,
    }).filter(([, value]) => value !== undefined),
  );
  if (mcp.connectVia === 'device') metadata.connectVia = 'device';
  if (mcp.boundDeviceId) metadata.boundDeviceId = mcp.boundDeviceId;
  if (plugin.type === 'plugin') {
    metadata[MARKETPLACE_INSTALL_COMPLETED_KEY] = true;
    // The connector runtime cannot read the legacy manifest once its row is
    // removed. Carry the market's per-tool approvals so a mandatory tool does
    // not become automatic after migration; a tool the market never declared
    // stays approval-required by the sync policy.
    metadata[MARKETPLACE_TOOL_POLICIES_KEY] = marketplaceToolPolicies(plugin);
  }

  const base = {
    identifier: plugin.identifier,
    isEnabled: true,
    name: manifest?.meta?.title ?? manifest?.name ?? plugin.identifier,
    sourceType:
      plugin.type === 'plugin' ? ConnectorSourceType.marketplace : ConnectorSourceType.custom,
    status: ConnectorStatus.disconnected,
  };

  if (mcp.type === 'stdio') {
    if (!mcp.command) return { ok: false, reason: 'no-endpoint' };
    const env = mergeDefined(trimRecord(mcp.env), settings);
    return {
      ok: true,
      payload: {
        ...base,
        mcpConnectionType: ConnectorMcpConnectionType.stdio,
        mcpServerUrl: null,
        mcpStdioConfig: {
          args: mcp.args?.map((arg) => fillPlaceholders(arg, settings, (value) => value)),
          command: mcp.command,
          ...(env ? { env } : {}),
        },
        metadata,
      },
    };
  }

  if (mcp.type === 'cloud') {
    if (!mcp.cloudEndPoint) return { ok: false, reason: 'no-endpoint' };
    const customHeaders = mergeDefined(headers, settings);
    return {
      ok: true,
      payload: {
        ...base,
        mcpConnectionType: ConnectorMcpConnectionType.cloud,
        mcpServerUrl: null,
        metadata: {
          ...metadata,
          cloudEndPoint: mcp.cloudEndPoint,
          ...(customHeaders ? { customHeaders } : {}),
        },
      },
    };
  }

  if (!validHttpUrl(mcp.url)) return { ok: false, reason: 'no-endpoint' };
  const rendered = renderUrlTemplate(mcp.url!, settings);
  const headerSettings = omitKeys(settings, rendered.usedKeys);
  const customHeaders = mergeDefined(headers, headerSettings);
  if (customHeaders) metadata.customHeaders = customHeaders;

  const auth = mcp.auth;
  if (auth?.type === 'bearer' && auth.token?.trim()) {
    return {
      ok: true,
      payload: {
        ...base,
        credentials: JSON.stringify({ token: auth.token.trim(), type: 'bearer' }),
        mcpConnectionType: ConnectorMcpConnectionType.http,
        mcpServerUrl: rendered.url,
        metadata,
      },
    };
  }

  if (auth?.type === 'oauth2' && auth.accessToken) {
    return {
      ok: true,
      payload: {
        ...base,
        credentials: JSON.stringify({ accessToken: auth.accessToken, type: 'oauth2' }),
        mcpConnectionType: ConnectorMcpConnectionType.http,
        mcpServerUrl: rendered.url,
        metadata,
        oidcConfig: {
          clientId: auth.clientId,
          clientSecret: auth.clientSecret,
          scheme: auth.clientId ? 'pre_registration' : 'dcr',
        },
      },
    };
  }

  return {
    ok: true,
    payload: {
      ...base,
      mcpConnectionType: ConnectorMcpConnectionType.http,
      mcpServerUrl: rendered.url,
      metadata,
    },
  };
};

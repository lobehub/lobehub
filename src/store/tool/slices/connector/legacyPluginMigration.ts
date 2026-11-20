import { type LobeToolCustomPlugin } from '@lobechat/types';

import { ConnectorSourceType } from '@/database/schemas';

/**
 * Decrypted-shape input for `connector.create`. Mirrors the runtime payload the
 * tRPC procedure expects (kept structural so we don't import server types here).
 */
export interface MigrationCreatePayload {
  credentials?:
    { token: string; type: 'bearer' } | { headers: Record<string, string>; type: 'header' };
  identifier: string;
  isEnabled: true;
  mcpConnectionType: 'http' | 'stdio' | 'cloud';
  mcpServerUrl?: string;
  mcpStdioConfig?: { args: string[]; command: string; env?: Record<string, string> };
  metadata?: Record<string, unknown>;
  name: string;
  sourceType: typeof ConnectorSourceType.custom;
}

export type MigrationResult =
  | { ok: true; payload: MigrationCreatePayload }
  | { ok: false; reason: 'no-mcp' | 'no-endpoint' | 'unsupported-transport' };

/** Drop empty key/value pairs a user may have left behind in an editor. */
const cleanRecord = (record?: Record<string, string>): Record<string, string> | undefined => {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return undefined;
  const cleaned = Object.fromEntries(
    Object.entries(record).filter(([k, v]) => k.trim() && (v ?? '').trim()),
  );
  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
};

/**
 * Translate a legacy `customParams.mcp` blob into a connector-create payload.
 *
 * Survey of 2960 prod `customPlugin` rows (2026-06-16) shows nine real shapes;
 * this helper covers seven valid ones and rejects two broken ones (no endpoint
 * at all). See memory/project_legacy_mcp_shapes.md for the full distribution.
 *
 * Bearer + non-empty headers is folded into a `type:'header'` credential that
 * carries `Authorization: Bearer <token>` alongside the user's extra headers —
 * the legacy form lets users set both independently, and dropping either side
 * silently would break tool calls for the 38 rows in that combo.
 */
export const buildConnectorPayloadFromLegacy = (legacy: LobeToolCustomPlugin): MigrationResult => {
  const mcp = legacy.customParams?.mcp;
  if (!mcp) return { ok: false, reason: 'no-mcp' };

  // `type` can be 'http' | 'stdio' | 'cloud' per the type, but field-survey shows
  // a tiny number of rows with `type='mcp'` or null — these were never functional
  // and have no transport endpoint; refuse to migrate them.
  const rawType = mcp.type;
  const normalizedType: 'http' | 'stdio' | 'cloud' =
    rawType === 'stdio' || rawType === 'cloud' ? rawType : 'http';

  const identifier = legacy.identifier;
  const displayName =
    legacy.manifest?.meta?.title || legacy.customParams?.description || identifier;

  const metadata: Record<string, unknown> = {};
  if (legacy.customParams?.description) metadata.description = legacy.customParams.description;
  if (legacy.customParams?.avatar) metadata.avatar = legacy.customParams.avatar;
  metadata.migratedFromCustomPlugin = true;

  if (normalizedType === 'stdio') {
    const command = (mcp.command ?? '').trim();
    if (!command) return { ok: false, reason: 'no-endpoint' };

    return {
      ok: true,
      payload: {
        identifier,
        isEnabled: true,
        mcpConnectionType: 'stdio',
        mcpStdioConfig: {
          args: Array.isArray(mcp.args) ? mcp.args : [],
          command,
          env: cleanRecord(mcp.env),
        },
        metadata,
        name: displayName,
        sourceType: ConnectorSourceType.custom,
      },
    };
  }

  // http / cloud branch: require a real URL.
  const url = (mcp.url ?? '').trim();
  if (!url) return { ok: false, reason: 'no-endpoint' };
  try {
    new URL(url);
  } catch {
    return { ok: false, reason: 'no-endpoint' };
  }

  // Auth derivation — see preamble: bearer + headers folds into a header credential
  // with Authorization injected; bearer-alone stays bearer; headers-alone stays header.
  const bearerToken =
    mcp.auth?.type === 'bearer' && typeof mcp.auth.token === 'string'
      ? mcp.auth.token.trim()
      : undefined;
  const extraHeaders = cleanRecord(mcp.headers);

  let credentials: MigrationCreatePayload['credentials'];
  if (bearerToken && extraHeaders) {
    credentials = {
      headers: { Authorization: `Bearer ${bearerToken}`, ...extraHeaders },
      type: 'header',
    };
  } else if (bearerToken) {
    credentials = { token: bearerToken, type: 'bearer' };
  } else if (extraHeaders) {
    credentials = { headers: extraHeaders, type: 'header' };
  }

  // The choice to connect through the device carries over (HTTP only)
  if (normalizedType === 'http' && mcp.connectVia === 'device') metadata.connectVia = 'device';

  return {
    ok: true,
    payload: {
      ...(credentials ? { credentials } : {}),
      identifier,
      isEnabled: true,
      mcpConnectionType: normalizedType,
      mcpServerUrl: url,
      metadata,
      name: displayName,
      sourceType: ConnectorSourceType.custom,
    },
  };
};

export interface MigrationSaveDeps {
  createConnector: (payload: MigrationCreatePayload) => Promise<{ id: string; isNew: boolean }>;
  deleteConnector: (id: string) => Promise<void>;
  refreshLists: () => Promise<void>;
  syncConnectorTools: (id: string, payload: MigrationCreatePayload) => Promise<void>;
  uninstallCustomPlugin: (identifier: string) => Promise<void>;
}

export type MigrationSaveResult =
  | { ok: true; connectorId: string }
  | { ok: false; reason: 'no-mcp' | 'no-endpoint' | 'unsupported-transport' };

export const executeLegacyMigrationSave = async (
  legacyPlugin: LobeToolCustomPlugin,
  formValue: LobeToolCustomPlugin,
  deps: MigrationSaveDeps,
): Promise<MigrationSaveResult> => {
  const built = buildConnectorPayloadFromLegacy(formValue);
  if (!built.ok) return built;

  // The identifier is the immutable join key between `agentConfig.plugins[i]`
  // and the connector / legacy-plugin row. DevModal's edit form leaves the
  // identifier field editable, so a user could rename it during migration —
  // doing so would orphan every agent that had this plugin enabled (the new
  // connector lands under a new key while the legacy row, and its old key in
  // `agentConfig.plugins`, vanish). Force the legacy identifier here so the
  // promoted connector keeps the same join key the agent already references.
  const payload: MigrationCreatePayload = {
    ...built.payload,
    identifier: legacyPlugin.identifier,
  };

  const { id, isNew } = await deps.createConnector(payload);

  try {
    try {
      await deps.syncConnectorTools(id, payload);
    } catch (error) {
      // The server owns the upsert decision. A cached list may omit a connector
      // that was already installed before this attempt.
      if (isNew) {
        await deps.deleteConnector(id).catch((rollbackError) => {
          console.error('[connector-migration] rollback after failed sync failed', rollbackError);
        });
      }
      throw error;
    }

    // Keep the synced connector if legacy cleanup fails (connector-first runtime).
    await deps.uninstallCustomPlugin(legacyPlugin.identifier).catch((error) => {
      console.error('[connector-migration] uninstall legacy plugin failed', error);
    });

    return { connectorId: id, ok: true };
  } finally {
    // Refresh only after the writes finish. A stalled list must neither hold
    // the save open nor turn a successful tool sync into a rollback.
    void deps.refreshLists().catch((error) => {
      console.error('[connector-migration] refreshing lists failed', error);
    });
  }
};

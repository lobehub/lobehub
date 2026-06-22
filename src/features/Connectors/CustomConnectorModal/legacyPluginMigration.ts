import { type LobeToolCustomPlugin } from '@lobechat/types';

import { ConnectorSourceType } from '@/database/schemas';

/**
 * Decrypted-shape input for `connector.create`. Mirrors the runtime payload the
 * tRPC procedure expects (kept structural so we don't import server types here).
 */
export interface MigrationCreatePayload {
  credentials?:
    | { token: string; type: 'bearer' }
    | { headers: Record<string, string>; type: 'header' };
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
export const buildConnectorPayloadFromLegacy = (
  legacy: LobeToolCustomPlugin,
): MigrationResult => {
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
    legacy.manifest?.meta?.title ||
    legacy.customParams?.description ||
    identifier;

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

/**
 * Orchestrate the legacy → connector save flow. Sequence matters:
 *
 *   1. Build payload from legacy shape; reject early on broken data.
 *   2. `createConnector` — server is idempotent on `(user_id, identifier)` so
 *      a half-baked marketplace connector from the old `syncPluginTools` path
 *      becomes an UPDATE, no client-side collision branch needed.
 *   3. `syncConnectorTools` — fail-loud. A throw here BAILS BEFORE step 4, so
 *      the legacy plugin row survives and the user keeps a working agent.
 *      Re-opening "Configure" later re-runs the same steps (all idempotent).
 *   4. `uninstallCustomPlugin` — best-effort. A throw is logged but swallowed;
 *      the runtime's `connectorIdentifierSet` filter in
 *      `aiAgent/index.ts:1717` dedupes by identifier (connector wins), so a
 *      lingering legacy row is harmless and the next save retries cleanup.
 *
 * Returning the validation failure inline (vs throwing) lets the modal show a
 * friendly toast distinct from a network error.
 */
export interface MigrationSaveDeps {
  createConnector: (payload: MigrationCreatePayload) => Promise<string>;
  syncConnectorTools: (id: string) => Promise<void>;
  uninstallCustomPlugin: (id: string) => Promise<void>;
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

  const newConnectorId = await deps.createConnector(payload);
  await deps.syncConnectorTools(newConnectorId);

  try {
    await deps.uninstallCustomPlugin(legacyPlugin.identifier);
  } catch (e) {
    console.error('[connector-migration] uninstall legacy plugin failed', e);
  }

  return { connectorId: newConnectorId, ok: true };
};

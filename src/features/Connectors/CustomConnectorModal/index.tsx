import { type LobeToolCustomPlugin } from '@lobechat/types';
import { memo, useEffect, useMemo, useRef, useState } from 'react';

import type { ConnectorCredentials, OIDCConfig } from '@/database/schemas';
import { ConnectorSourceType } from '@/database/schemas';
import DevModal from '@/features/PluginDevModal';
import { useToolStore } from '@/store/tool';
import { connectorSelectors } from '@/store/tool/slices/connector';

import { executeLegacyMigrationSave } from './legacyPluginMigration';

interface CustomConnectorModalProps {
  connectorId?: string;
  /**
   * Legacy `user_installed_plugins` record being upgraded to a connector. When
   * set (and `connectorId` is not), the modal opens in **migration mode**: the
   * form is pre-filled from the legacy `customParams.mcp` blob, and on save we
   * create the connector + sync its tools + delete the legacy plugin row.
   *
   * The legacy row is left untouched until BOTH create and tool-sync succeed,
   * so a transient failure (MCP server unreachable, etc.) leaves the user with
   * their working legacy plugin and a "retry" path on the next save.
   */
  legacyPlugin?: LobeToolCustomPlugin;
  onClose: () => void;
  onEditSuccess?: () => void;
  open: boolean;
}

interface OAuthPopupResult {
  error?: string;
  status: 'success' | 'error' | 'dismissed';
  synced?: boolean;
}

/**
 * Wait for an already-opened popup to report the OAuth result. The popup MUST be
 * opened synchronously from the user's click (see DevModal) and then navigated
 * to the authorize URL. The callback page posts a message before attempting
 * `window.close()`, so the message signal is reliable even when the browser
 * refuses to close a cross-origin-navigated popup.
 */
const waitForOAuthPopup = (popup: Window, connectorId: string): Promise<OAuthPopupResult> =>
  new Promise((resolve) => {
    const cleanup = () => {
      window.removeEventListener('message', onMessage);
      clearInterval(timer);
    };

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (!data || data.type !== 'lobe-connector-oauth') return;
      if (data.connectorId && data.connectorId !== connectorId) return;
      cleanup();
      resolve(
        data.success
          ? { status: 'success', synced: data.synced }
          : { error: data.error, status: 'error' },
      );
    };

    window.addEventListener('message', onMessage);

    const timer = setInterval(() => {
      if (popup.closed) {
        cleanup();
        resolve({ status: 'dismissed' });
      }
    }, 800);
  });

/** Drop empty key/value pairs a user may have left behind in an editor. */
const cleanRecord = (record?: Record<string, string>): Record<string, string> | undefined => {
  if (!record) return undefined;
  const cleaned = Object.fromEntries(
    Object.entries(record).filter(([k, v]) => k.trim() && (v ?? '').trim()),
  );
  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
};

/**
 * "Add / Edit custom connector" entry. Reuses the rich PluginDevModal MCP form,
 * but persists everything onto the connector subsystem (the single backend for
 * custom MCP) instead of the legacy custom-plugin store:
 *
 * Create mode:
 * - none / bearer / custom headers → create + sync the tool list directly
 * - OAuth → create with the OIDC config, then run the authorize-code popup flow
 *   (the popup is opened synchronously inside DevModal's save handler)
 *
 * Edit mode (connectorId provided):
 * - Pre-fills the form from the existing connector record
 * - Calls updateConnector instead of createConnector on save
 * - Clears credentials when the server URL changes
 */
const CustomConnectorModal = memo<CustomConnectorModalProps>(
  ({ open, onClose, connectorId, legacyPlugin, onEditSuccess }) => {
    const createConnector = useToolStore((s) => s.createConnector);
    const updateConnector = useToolStore((s) => s.updateConnector);
    const getConnectorForEdit = useToolStore((s) => s.getConnectorForEdit);
    const startConnectorOAuth = useToolStore((s) => s.startConnectorOAuth);
    const syncConnectorTools = useToolStore((s) => s.syncConnectorTools);
    const fetchConnectors = useToolStore((s) => s.fetchConnectors);
    const uninstallCustomPlugin = useToolStore((s) => s.uninstallCustomPlugin);

    const connector = useToolStore(
      connectorId ? connectorSelectors.connectorById(connectorId) : () => undefined,
    );

    const isEditMode = Boolean(connectorId);
    const isMigrationMode = !isEditMode && Boolean(legacyPlugin);

    // Full connector data (with decrypted credentials) fetched for the edit form.
    // null = not yet loaded; object = loaded (credentials may still be null if none set).
    type EditFetchedData = {
      credentials: Exclude<ConnectorCredentials, { type: 'oauth2' }> | null;
      oidcConfig: Omit<OIDCConfig, 'clientSecret'> | null | undefined;
    };
    const [editFetchedData, setEditFetchedData] = useState<EditFetchedData | null>(null);
    const editFetchController = useRef<AbortController | null>(null);

    useEffect(() => {
      if (!open || !connectorId) {
        setEditFetchedData(null);
        return;
      }
      // Cancel any in-flight fetch from a previous open
      editFetchController.current?.abort();
      const controller = new AbortController();
      editFetchController.current = controller;

      setEditFetchedData(null);
      getConnectorForEdit(connectorId).then((data) => {
        if (controller.signal.aborted) return;
        setEditFetchedData({
          credentials: (data?.credentials ?? null) as EditFetchedData['credentials'],
          oidcConfig: (data?.oidcConfig ?? null) as EditFetchedData['oidcConfig'],
        });
      });

      return () => {
        controller.abort();
      };
    }, [open, connectorId]);

    // Build the pre-fill value for edit mode once the credentials fetch completes.
    // Returns undefined while loading so DevModal defers seeding the form.
    //
    // Migration mode skips the fetch — the legacy `customParams.mcp` blob is
    // already in the shape DevModal expects, so we hand it through unchanged.
    const editValue = useMemo((): LobeToolCustomPlugin | undefined => {
      if (isMigrationMode) return legacyPlugin;
      if (!isEditMode || !connector || editFetchedData === null) return undefined;

      const c = connector as typeof connector & {
        mcpStdioConfig?: { args?: string[]; command?: string; env?: Record<string, string> };
      };
      const mcpStdioConfig = c.mcpStdioConfig;

      const { credentials, oidcConfig } = editFetchedData;

      const authType = oidcConfig
        ? 'oauth2'
        : credentials?.type === 'bearer'
          ? 'bearer'
          : credentials?.type === 'header'
            ? 'header'
            : 'none';

      // Custom headers now live in metadata; older rows stored them as a
      // 'header'-type credential. Read metadata first, fall back to the legacy
      // credential so existing connectors still pre-fill their headers — and do
      // so regardless of the auth radio (headers can coexist with bearer auth).
      const customHeaders =
        (connector.metadata?.customHeaders as Record<string, string> | undefined) ??
        (credentials?.type === 'header'
          ? (credentials as { headers: Record<string, string> }).headers
          : undefined);

      return {
        customParams: {
          description: connector.metadata?.description as string | undefined,
          mcp: {
            args: mcpStdioConfig?.args,
            auth: {
              clientId: oidcConfig?.clientId,
              token: authType === 'bearer' ? (credentials as { token: string })?.token : undefined,
              type: authType === 'header' ? 'none' : authType,
            },
            command: mcpStdioConfig?.command,
            env: mcpStdioConfig?.env,
            headers: customHeaders,
            type: (connector.mcpConnectionType ?? 'http') as 'http' | 'stdio',
            url: connector.mcpServerUrl ?? undefined,
          },
        },
        identifier: connector.identifier,
        type: 'customPlugin' as const,
      };
    }, [isEditMode, isMigrationMode, legacyPlugin, connector, editFetchedData]);

    const handleSave = async (value: LobeToolCustomPlugin, ctx?: { oauthPopup?: Window | null }) => {
      // ── Migration mode ────────────────────────────────────────────────────
      // Promote a legacy `user_installed_plugins.type='customPlugin'` row into
      // a `user_connectors` row. Server `connector.create` is idempotent on
      // `(user_id, identifier)` — a same-name half-baked connector from the
      // old `syncPluginTools` path becomes an UPDATE here, no collision branch
      // needed.
      //
      // Order matters: create → sync tools → uninstall legacy. If sync fails
      // we bail BEFORE uninstall so the legacy plugin still serves the agent
      // and the user can retry by re-opening the modal. After uninstall, the
      // runtime sees a single connector row keyed by the same identifier, and
      // `agentConfig.plugins[i]` already matches.
      if (isMigrationMode && legacyPlugin) {
        // `value` is the full form state — DevModal seeded itself from
        // `legacyPlugin` via `editValue`, so anything the user edited (or left
        // alone) is already inside `value`. Hand it to the orchestrator.
        const result = await executeLegacyMigrationSave(legacyPlugin, value, {
          createConnector,
          syncConnectorTools,
          uninstallCustomPlugin,
        });
        if (!result.ok) {
          throw new Error(
            result.reason === 'no-mcp'
              ? 'This custom plugin has no MCP configuration to migrate.'
              : result.reason === 'no-endpoint'
                ? 'This custom plugin is missing a URL (for HTTP) or command (for stdio).'
                : 'This custom plugin uses an unsupported transport.',
          );
        }
        onEditSuccess?.();
        return;
      }

      const mcp = (value.customParams?.mcp ?? {}) as {
        args?: string[];
        auth?: { clientId?: string; clientSecret?: string; token?: string; type?: string };
        command?: string;
        env?: Record<string, string>;
        headers?: Record<string, string>;
        type?: 'http' | 'stdio';
        url?: string;
      };
      const identifier = value.identifier;
      const isHttp = mcp.type !== 'stdio';
      const authType = mcp.auth?.type;

      // ── Edit mode ─────────────────────────────────────────────────────────
      if (isEditMode && connectorId) {
        const newUrl = isHttp ? mcp.url?.trim() : undefined;
        const urlChanged = newUrl !== (connector?.mcpServerUrl ?? undefined);

        const patch: Record<string, any> = {};

        if (newUrl !== undefined) patch.mcpServerUrl = newUrl;

        // Custom headers live in metadata (independent of the auth credential and
        // of the server URL), so always re-sync them from the form. Merge into the
        // existing metadata — a jsonb update replaces the whole column, so other
        // keys (e.g. description) must be carried over. Also migrates legacy rows
        // that stored headers as a 'header' credential (cleared below).
        //
        // Guard on `connector`: only rewrite metadata once the connector record is
        // loaded, so we never overwrite a populated column with `{}` (which would
        // drop sibling keys like description). In practice the form can't be
        // submitted before `connector` resolves, but this keeps it safe.
        const headers = cleanRecord(mcp.headers);
        if (connector) {
          const nextMetadata: Record<string, unknown> = { ...(connector.metadata ?? {}) };
          if (headers) nextMetadata.customHeaders = headers;
          else delete nextMetadata.customHeaders;
          patch.metadata = nextMetadata;
        }

        if (urlChanged) {
          // Clear stale auth credentials whenever the server URL changes.
          patch.credentials = null;
        } else if (authType === 'bearer' && mcp.auth?.token?.trim()) {
          patch.credentials = { token: mcp.auth.token.trim(), type: 'bearer' as const };
        } else if (authType !== 'oauth2') {
          // 'none' / header-only auth: no separate auth credential — custom headers
          // are persisted via metadata above, so clear the credentials column.
          patch.credentials = null;
        }

        if (authType === 'oauth2') {
          const clientId = mcp.auth?.clientId?.trim();
          patch.oidcConfig = {
            clientId: clientId || undefined,
            clientSecret: mcp.auth?.clientSecret?.trim() || undefined,
            scheme: clientId ? 'pre_registration' : 'dcr',
          };
        }

        await updateConnector(connectorId, patch);

        if (authType === 'oauth2' && isHttp) {
          const popup = ctx?.oauthPopup ?? null;
          if (!popup) throw new Error('OAuth popup was blocked');
          try {
            const authorizationUrl = await startConnectorOAuth(connectorId);
            popup.location.href = authorizationUrl;
            const result = await waitForOAuthPopup(popup, connectorId);
            await fetchConnectors();
            if (result.status !== 'success') {
              throw new Error(result.error || 'Authorization was not completed');
            }
          } catch (e) {
            if (!popup.closed) popup.close();
            throw e;
          }
        }

        onEditSuccess?.();
        return;
      }

      // ── Create mode ───────────────────────────────────────────────────────
      const base = {
        identifier,
        mcpConnectionType: (mcp.type ?? 'http') as 'http' | 'stdio',
        mcpServerUrl: isHttp ? mcp.url?.trim() : undefined,
        mcpStdioConfig: isHttp
          ? undefined
          : { args: mcp.args ?? [], command: (mcp.command ?? '').trim(), env: cleanRecord(mcp.env) },
        name: identifier,
        sourceType: ConnectorSourceType.custom,
      };

      // OAuth: create with the OIDC config, then drive the authorize popup that
      // DevModal already opened synchronously for us.
      if (isHttp && authType === 'oauth2') {
        const popup = ctx?.oauthPopup ?? null;
        if (!popup) throw new Error('OAuth popup was blocked');

        const clientId = mcp.auth?.clientId?.trim();
        try {
          const newConnectorId = await createConnector({
            ...base,
            oidcConfig: {
              clientId: clientId || undefined,
              clientSecret: mcp.auth?.clientSecret?.trim() || undefined,
              // client_id present → pre-registration; absent → dynamic registration.
              scheme: clientId ? 'pre_registration' : 'dcr',
            },
          });

          const authorizationUrl = await startConnectorOAuth(newConnectorId);
          popup.location.href = authorizationUrl;
          const result = await waitForOAuthPopup(popup, newConnectorId);
          await fetchConnectors();
          if (result.status !== 'success') {
            throw new Error(result.error || 'Authorization was not completed');
          }
        } catch (e) {
          // Close the blank/in-flight popup we opened so it isn't left dangling.
          // On success the OAuth callback page closes it itself.
          if (!popup.closed) popup.close();
          throw e;
        }
        return;
      }

      // The auth credential (bearer token) and custom headers are stored
      // separately: the credential goes in the encrypted single-kind
      // `credentials` column, while custom headers live in
      // `metadata.customHeaders` so they can coexist with no-auth OR bearer
      // (the credentials column can only hold one credential kind at a time).
      const credentials =
        authType === 'bearer' && mcp.auth?.token?.trim()
          ? ({ token: mcp.auth.token.trim(), type: 'bearer' } as const)
          : undefined;
      const headers = cleanRecord(mcp.headers);

      const newConnectorId = await createConnector({
        ...base,
        credentials,
        metadata: headers ? { customHeaders: headers } : undefined,
      });
      await syncConnectorTools(newConnectorId);
    };

    // In migration mode the Delete button must actually uninstall the legacy
    // `user_installed_plugins` row — DevModal shows a success toast either way,
    // so leaving `onDelete` undefined here would give the user a confirmation
    // for an action that never happened. Wired only in migration mode; the
    // regular edit branch's Delete-button behavior is unchanged by this PR.
    const handleDelete =
      isMigrationMode && legacyPlugin
        ? () => {
            uninstallCustomPlugin(legacyPlugin.identifier);
            onClose();
          }
        : undefined;

    return (
      <DevModal
        enableOAuth
        mode={isEditMode || isMigrationMode ? 'edit' : 'create'}
        open={open}
        value={editValue}
        onDelete={handleDelete}
        onSave={handleSave}
        onOpenChange={(next) => {
          if (!next) onClose();
        }}
      />
    );
  },
);

CustomConnectorModal.displayName = 'CustomConnectorModal';

export default CustomConnectorModal;

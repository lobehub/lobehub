import { type LobeToolCustomPlugin } from '@lobechat/types';
import { memo, useEffect, useMemo, useRef, useState } from 'react';

import type { ConnectorCredentials, OIDCConfig } from '@/database/schemas';
import { ConnectorSourceType } from '@/database/schemas';
import DevModal from '@/features/PluginDevModal';
import { useToolStore } from '@/store/tool';
import { connectorSelectors } from '@/store/tool/slices/connector';

interface CustomConnectorModalProps {
  connectorId?: string;
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
  ({ open, onClose, connectorId, onEditSuccess }) => {
    const createConnector = useToolStore((s) => s.createConnector);
    const updateConnector = useToolStore((s) => s.updateConnector);
    const getConnectorForEdit = useToolStore((s) => s.getConnectorForEdit);
    const startConnectorOAuth = useToolStore((s) => s.startConnectorOAuth);
    const syncConnectorTools = useToolStore((s) => s.syncConnectorTools);
    const fetchConnectors = useToolStore((s) => s.fetchConnectors);

    const connector = useToolStore(
      connectorId ? connectorSelectors.connectorById(connectorId) : () => undefined,
    );

    const isEditMode = Boolean(connectorId);

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
    const editValue = useMemo((): LobeToolCustomPlugin | undefined => {
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
            headers:
              authType === 'header'
                ? (credentials as { headers: Record<string, string> })?.headers
                : undefined,
            type: (connector.mcpConnectionType ?? 'http') as 'http' | 'stdio',
            url: connector.mcpServerUrl ?? undefined,
          },
        },
        identifier: connector.identifier,
        type: 'customPlugin' as const,
      };
    }, [isEditMode, connector, editFetchedData]);

    const handleSave = async (value: LobeToolCustomPlugin, ctx?: { oauthPopup?: Window | null }) => {
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

        if (urlChanged) {
          // Clear stale credentials whenever the server URL changes.
          patch.credentials = null;
        } else if (authType === 'bearer' && mcp.auth?.token?.trim()) {
          patch.credentials = { token: mcp.auth.token.trim(), type: 'bearer' as const };
        } else if (authType !== 'oauth2') {
          // Auth radio 'none' covers both "no auth" and "header auth" (headers live in
          // the Advanced section, not the auth radio). Mirror the create-mode logic:
          // any filled headers → header credentials; empty → clear credentials.
          const headers = cleanRecord(mcp.headers);
          if (headers) {
            patch.credentials = { headers, type: 'header' as const };
          } else {
            patch.credentials = null;
          }
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

      // None / bearer / custom headers: store credentials and sync the tool list.
      const credentials =
        authType === 'bearer' && mcp.auth?.token?.trim()
          ? ({ token: mcp.auth.token.trim(), type: 'bearer' } as const)
          : (() => {
              const headers = cleanRecord(mcp.headers);
              return headers ? ({ headers, type: 'header' } as const) : undefined;
            })();

      const newConnectorId = await createConnector({ ...base, credentials });
      await syncConnectorTools(newConnectorId);
    };

    return (
      <DevModal
        enableOAuth
        mode={isEditMode ? 'edit' : 'create'}
        open={open}
        value={editValue}
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

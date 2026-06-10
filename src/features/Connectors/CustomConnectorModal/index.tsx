import { type LobeToolCustomPlugin } from '@lobechat/types';
import { memo } from 'react';

import { ConnectorSourceType } from '@/database/schemas';
import DevModal from '@/features/PluginDevModal';
import { useToolStore } from '@/store/tool';

interface CustomConnectorModalProps {
  onClose: () => void;
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
 * "Add custom connector" entry. Reuses the rich PluginDevModal MCP form, but
 * persists everything onto the connector subsystem (the single backend for
 * custom MCP) instead of the legacy custom-plugin store:
 *
 * - none / bearer / custom headers → create + sync the tool list directly
 * - OAuth → create with the OIDC config, then run the authorize-code popup flow
 *   (the popup is opened synchronously inside DevModal's save handler)
 */
const CustomConnectorModal = memo<CustomConnectorModalProps>(({ open, onClose }) => {
  const createConnector = useToolStore((s) => s.createConnector);
  const startConnectorOAuth = useToolStore((s) => s.startConnectorOAuth);
  const syncConnectorTools = useToolStore((s) => s.syncConnectorTools);
  const fetchConnectors = useToolStore((s) => s.fetchConnectors);

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
        const connectorId = await createConnector({
          ...base,
          oidcConfig: {
            clientId: clientId || undefined,
            clientSecret: mcp.auth?.clientSecret?.trim() || undefined,
            // client_id present → pre-registration; absent → dynamic registration.
            scheme: clientId ? 'pre_registration' : 'dcr',
          },
        });

        const authorizationUrl = await startConnectorOAuth(connectorId);
        popup.location.href = authorizationUrl;
        const result = await waitForOAuthPopup(popup, connectorId);
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

    const connectorId = await createConnector({ ...base, credentials });
    await syncConnectorTools(connectorId);
  };

  return (
    <DevModal
      enableOAuth
      mode={'create'}
      open={open}
      onSave={handleSave}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    />
  );
});

CustomConnectorModal.displayName = 'CustomConnectorModal';

export default CustomConnectorModal;

import { Modal } from '@lobehub/ui/base-ui';
import { App, Input } from 'antd';
import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ConnectorSourceType } from '@/database/schemas';
import { lambdaClient } from '@/libs/trpc/client';
import { useToolStore } from '@/store/tool';
import { connectorSelectors } from '@/store/tool/slices/connector';

interface AddConnectorModalProps {
  /** If provided, opens in edit mode pre-filling the form from the existing connector. */
  connectorId?: string;
  onClose: () => void;
  open: boolean;
}

interface OAuthPopupResult {
  /** Provider/exchange error reason when status === 'error'. */
  error?: string;
  // 'success' — authorized; 'error' — provider/exchange failure (reason in
  // `error`); 'dismissed' — popup closed without a result (user cancelled).
  status: 'success' | 'error' | 'dismissed';
  /** On success, whether the tool list synced (false = authorized but unusable). */
  synced?: boolean;
}

/**
 * Wait for an already-opened popup to report the OAuth result.
 *
 * The popup MUST be opened synchronously from the user's click (browsers block
 * `window.open` once an async boundary is crossed), then navigated to the
 * authorize URL. The callback page posts a message before attempting
 * `window.close()`, so the message signal is reliable even when the browser
 * refuses to close a popup that navigated cross-origin. The popup-closed path is
 * a fallback for when the user dismisses the window without finishing.
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

const AddConnectorModal = memo<AddConnectorModalProps>(({ open, onClose, connectorId }) => {
  const { t } = useTranslation('tool');
  const { message } = App.useApp();
  const createConnector = useToolStore((s) => s.createConnector);
  const updateConnector = useToolStore((s) => s.updateConnector);
  const startConnectorOAuth = useToolStore((s) => s.startConnectorOAuth);
  const syncConnectorTools = useToolStore((s) => s.syncConnectorTools);
  const fetchConnectors = useToolStore((s) => s.fetchConnectors);

  const existingConnector = useToolStore(connectorSelectors.connectorById(connectorId ?? ''));
  const isEditMode = !!connectorId;

  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Pre-fill form when opening in edit mode
  useEffect(() => {
    if (open && isEditMode && existingConnector) {
      setName(existingConnector.name);
      setUrl(existingConnector.mcpServerUrl ?? '');
      setClientId('');
      setClientSecret('');
      setShowAdvanced(false);
    }
  }, [open, isEditMode, existingConnector]);

  // Show the exact redirect URI the SERVER will use (APP_URL-based), so what the
  // user registers matches what is sent at authorize time. Fall back to the
  // current origin only if the query fails.
  const [redirectUri, setRedirectUri] = useState('');
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    lambdaClient.connector.getRedirectUri
      .query()
      .then((r) => {
        if (!cancelled) setRedirectUri(r.redirectUri);
      })
      .catch(() => {
        if (!cancelled && typeof window !== 'undefined') {
          setRedirectUri(`${window.location.origin}/oauth/connector/callback`);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const reset = () => {
    setName('');
    setUrl('');
    setClientId('');
    setClientSecret('');
    setShowAdvanced(false);
    setSubmitting(false);
  };

  const handleAdd = async () => {
    if (!name.trim() || !url.trim()) return;

    // Open the popup synchronously within the click handler, otherwise the
    // browser blocks it once we cross the first `await` below. It's navigated to
    // the real authorize URL after the connector + OAuth-start mutations resolve.
    const popup = window.open('about:blank', 'lobe-connector-oauth', 'width=600,height=720');
    if (!popup) {
      message.error(
        t('connector.add.popupBlocked', 'Please allow popups for this site and try again.'),
      );
      return;
    }

    setSubmitting(true);

    try {
      const trimmedClientId = clientId.trim();
      // client_id present → pre-registration; absent → dynamic client registration (DCR).
      const scheme = trimmedClientId ? 'pre_registration' : 'dcr';

      const newConnectorId = await createConnector({
        identifier: name.toLowerCase().replaceAll(/\s+/g, '-'),
        mcpConnectionType: 'http',
        mcpServerUrl: url.trim(),
        name: name.trim(),
        oidcConfig: {
          clientId: trimmedClientId || undefined,
          clientSecret: clientSecret.trim() || undefined,
          scheme,
        },
        sourceType: ConnectorSourceType.custom,
      });

      // Kick off the OAuth flow. The callback exchanges the code and syncs the
      // tool list server-side, so we only need to refresh once it reports back.
      // If the server turns out not to require OAuth (no authorization server
      // discovered), fall back to a plain tool sync for public MCP servers.
      try {
        const authorizationUrl = await startConnectorOAuth(newConnectorId);
        popup.location.href = authorizationUrl;
        const result = await waitForOAuthPopup(popup, newConnectorId);
        // Reflect the server-side state regardless of how the popup ended
        // (window.close is often blocked for cross-origin-navigated popups).
        await fetchConnectors();
        if (result.status === 'success') {
          if (result.synced === false) {
            message.warning(
              t(
                'connector.add.syncFailed',
                'Authorized, but tools could not be synced. Click Sync to retry.',
              ),
            );
          } else {
            message.success(t('connector.add.success', 'Connector connected'));
          }
        } else if (result.status === 'error') {
          message.error(
            t('connector.add.authError', 'Authorization failed: {{reason}}', {
              reason: result.error || t('connector.add.unknownError', 'unknown error'),
            }),
          );
        } else {
          message.warning(t('connector.add.cancelled', 'Authorization was not completed'));
        }
      } catch {
        popup.close();
        try {
          await syncConnectorTools(newConnectorId);
          message.success(t('connector.add.success', 'Connector connected'));
        } catch {
          message.error(
            t(
              'connector.add.authFailed',
              'Could not connect. This server may require an OAuth Client ID in Advanced settings.',
            ),
          );
        }
      }

      reset();
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = async () => {
    if (!name.trim() || !url.trim() || !connectorId) return;

    const trimmedClientId = clientId.trim();
    const trimmedClientSecret = clientSecret.trim();
    const hasNewCredentials = !!trimmedClientId || !!trimmedClientSecret;
    const urlChanged = url.trim() !== (existingConnector?.mcpServerUrl ?? '');
    // Re-run OAuth if the URL changed or new credentials were supplied
    const needsReAuth = urlChanged || hasNewCredentials;

    let popup: Window | null = null;
    if (needsReAuth) {
      popup = window.open('about:blank', 'lobe-connector-oauth', 'width=600,height=720');
      if (!popup) {
        message.error(
          t('connector.add.popupBlocked', 'Please allow popups for this site and try again.'),
        );
        return;
      }
    }

    setSubmitting(true);
    try {
      const scheme = trimmedClientId ? 'pre_registration' : 'dcr';
      await updateConnector(connectorId, {
        ...(urlChanged ? { credentials: null } : {}),
        mcpServerUrl: url.trim(),
        name: name.trim(),
        ...(hasNewCredentials
          ? {
              oidcConfig: {
                clientId: trimmedClientId || undefined,
                clientSecret: trimmedClientSecret || undefined,
                scheme,
              },
            }
          : {}),
      });

      if (needsReAuth && popup) {
        try {
          const authorizationUrl = await startConnectorOAuth(connectorId);
          popup.location.href = authorizationUrl;
          const result = await waitForOAuthPopup(popup, connectorId);
          await fetchConnectors();
          if (result.status === 'success') {
            if (result.synced === false) {
              message.warning(
                t(
                  'connector.add.syncFailed',
                  'Authorized, but tools could not be synced. Click Sync to retry.',
                ),
              );
            } else {
              message.success(t('connector.edit.success', 'Connector updated'));
            }
          } else if (result.status === 'error') {
            message.error(
              t('connector.add.authError', 'Authorization failed: {{reason}}', {
                reason: result.error || t('connector.add.unknownError', 'unknown error'),
              }),
            );
          } else {
            message.warning(t('connector.add.cancelled', 'Authorization was not completed'));
          }
        } catch {
          popup.close();
          try {
            await syncConnectorTools(connectorId);
            message.success(t('connector.edit.success', 'Connector updated'));
          } catch {
            message.error(
              t(
                'connector.add.authFailed',
                'Could not connect. This server may require an OAuth Client ID in Advanced settings.',
              ),
            );
          }
        }
      } else {
        message.success(t('connector.edit.success', 'Connector updated'));
      }

      reset();
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = () => {
    reset();
    onClose();
  };

  const modalTitle = isEditMode
    ? t('connector.add.editTitle', 'Edit Connector')
    : t('connector.add.title', 'Add custom connector');

  const okText = isEditMode ? t('connector.add.update', 'Save') : t('connector.add.confirm', 'Add');

  return (
    <Modal
      cancelText={t('connector.add.cancel', 'Cancel')}
      confirmLoading={submitting}
      okButtonProps={{ disabled: !name.trim() || !url.trim() }}
      okText={okText}
      open={open}
      title={modalTitle}
      onCancel={handleCancel}
      onOk={isEditMode ? handleEdit : handleAdd}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <div style={{ fontSize: 12, marginBottom: 4 }}>{t('connector.add.name', 'Name')}</div>
          <Input
            placeholder={t('connector.add.namePlaceholder', 'My connector')}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div>
          <div style={{ fontSize: 12, marginBottom: 4 }}>
            {t('connector.add.url', 'Remote MCP server URL')}
          </div>
          <Input
            placeholder="https://mcp.example.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </div>

        {/* Advanced settings */}
        <div>
          <div
            style={{
              alignItems: 'center',
              cursor: 'pointer',
              display: 'flex',
              fontSize: 13,
              fontWeight: 500,
              gap: 4,
              userSelect: 'none',
            }}
            onClick={() => setShowAdvanced((v) => !v)}
          >
            {showAdvanced ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} />}
            {t('connector.add.advanced', 'Advanced settings')}
          </div>

          {showAdvanced && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
              <Input
                placeholder={t('connector.add.clientId', 'OAuth Client ID (optional)')}
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
              />
              <Input.Password
                autoComplete="new-password"
                placeholder={t('connector.add.clientSecret', 'OAuth Client Secret (optional)')}
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
              />
              <div style={{ color: 'var(--lobe-colors-neutral-500)', fontSize: 12 }}>
                {t('connector.add.redirectHint', 'Redirect URI to register with your OAuth app:')}
                <br />
                <code style={{ wordBreak: 'break-all' }}>{redirectUri}</code>
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
});

AddConnectorModal.displayName = 'AddConnectorModal';

export default AddConnectorModal;

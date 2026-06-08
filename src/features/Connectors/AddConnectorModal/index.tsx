import { Modal } from '@lobehub/ui/base-ui';
import { App, Input } from 'antd';
import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ConnectorSourceType } from '@/database/schemas';
import { useToolStore } from '@/store/tool';

interface AddConnectorModalProps {
  onClose: () => void;
  open: boolean;
}

type OAuthPopupResult = 'success' | 'closed';

/**
 * Open the authorize URL in a popup and resolve once it reports back.
 *
 * The callback page posts a message before attempting `window.close()`, so the
 * 'success' signal is reliable even when the browser refuses to close a popup
 * that navigated cross-origin. The popup-closed path is a fallback for when the
 * user dismisses the window without finishing.
 */
const runOAuthPopup = (authorizationUrl: string, connectorId: string): Promise<OAuthPopupResult> =>
  new Promise((resolve) => {
    const popup = window.open(authorizationUrl, 'lobe-connector-oauth', 'width=600,height=720');

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
      resolve(data.success ? 'success' : 'closed');
    };

    window.addEventListener('message', onMessage);

    const timer = setInterval(() => {
      if (popup?.closed) {
        cleanup();
        resolve('closed');
      }
    }, 800);
  });

const AddConnectorModal = memo<AddConnectorModalProps>(({ open, onClose }) => {
  const { t } = useTranslation('tool');
  const { message } = App.useApp();
  const createConnector = useToolStore((s) => s.createConnector);
  const startConnectorOAuth = useToolStore((s) => s.startConnectorOAuth);
  const syncConnectorTools = useToolStore((s) => s.syncConnectorTools);
  const fetchConnectors = useToolStore((s) => s.fetchConnectors);

  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const redirectUri =
    typeof window === 'undefined' ? '' : `${window.location.origin}/oauth/connector/callback`;

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
    setSubmitting(true);

    try {
      const trimmedClientId = clientId.trim();
      // client_id present → pre-registration; absent → dynamic client registration (DCR).
      const scheme = trimmedClientId ? 'pre_registration' : 'dcr';

      const connectorId = await createConnector({
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
        const authorizationUrl = await startConnectorOAuth(connectorId);
        const result = await runOAuthPopup(authorizationUrl, connectorId);
        // Reflect the server-side state regardless of how the popup ended
        // (window.close is often blocked for cross-origin-navigated popups).
        await fetchConnectors();
        if (result === 'success') {
          message.success(t('connector.add.success', 'Connector connected'));
        }
      } catch {
        try {
          await syncConnectorTools(connectorId);
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

  const handleCancel = () => {
    reset();
    onClose();
  };

  return (
    <Modal
      cancelText={t('connector.add.cancel', 'Cancel')}
      confirmLoading={submitting}
      okButtonProps={{ disabled: !name.trim() || !url.trim() }}
      okText={t('connector.add.confirm', 'Add')}
      open={open}
      title={t('connector.add.title', 'Add custom connector')}
      onCancel={handleCancel}
      onOk={handleAdd}
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

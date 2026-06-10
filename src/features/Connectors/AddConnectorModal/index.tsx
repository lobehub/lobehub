import { Flexbox, InputPassword } from '@lobehub/ui';
import { Modal } from '@lobehub/ui/base-ui';
import { App, Input, Radio } from 'antd';
import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import KeyValueEditor from '@/components/KeyValueEditor';
import MCPStdioCommandInput from '@/components/MCPStdioCommandInput';
import { ConnectorSourceType } from '@/database/schemas';
import ArgsInput from '@/features/PluginDevModal/MCPManifestForm/ArgsInput';
import MCPTypeSelect from '@/features/PluginDevModal/MCPManifestForm/MCPTypeSelect';
import { lambdaClient } from '@/libs/trpc/client';
import { useToolStore } from '@/store/tool';

interface AddConnectorModalProps {
  onClose: () => void;
  open: boolean;
}

/** Credentials the client may set directly — OAuth is handled by its own flow. */
type CredentialsInput =
  | { token: string; type: 'bearer' }
  | { headers: Record<string, string>; type: 'header' };

type AuthType = 'none' | 'apikey' | 'headers' | 'oauth';
type McpType = 'http' | 'stdio';

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

/** Drop empty key/value pairs a user may have left behind in the editor. */
const cleanHeaders = (headers: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(headers).filter(([k, v]) => k.trim() && v.trim()));

const AddConnectorModal = memo<AddConnectorModalProps>(({ open, onClose }) => {
  const { t } = useTranslation(['tool', 'plugin']);
  const { message } = App.useApp();
  const createConnector = useToolStore((s) => s.createConnector);
  const startConnectorOAuth = useToolStore((s) => s.startConnectorOAuth);
  const syncConnectorTools = useToolStore((s) => s.syncConnectorTools);
  const fetchConnectors = useToolStore((s) => s.fetchConnectors);

  const [mcpType, setMcpType] = useState<McpType>('http');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [authType, setAuthType] = useState<AuthType>('none');
  // Bearer token / API key value (sent as Authorization: Bearer <token>).
  const [token, setToken] = useState('');
  const [headers, setHeaders] = useState<Record<string, string>>({});
  // OAuth advanced
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  // STDIO
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState<string[]>([]);
  const [env, setEnv] = useState<Record<string, string>>({});

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [submitting, setSubmitting] = useState(false);

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
    setMcpType('http');
    setName('');
    setUrl('');
    setAuthType('none');
    setToken('');
    setHeaders({});
    setClientId('');
    setClientSecret('');
    setCommand('');
    setArgs([]);
    setEnv({});
    setShowAdvanced(false);
    setSubmitting(false);
  };

  const canSubmit = useMemo(() => {
    if (!name.trim()) return false;
    if (mcpType === 'http') return !!url.trim();
    return !!command.trim();
  }, [name, mcpType, url, command]);

  const buildCredentials = (): CredentialsInput | undefined => {
    if (authType === 'apikey' && token.trim()) return { token: token.trim(), type: 'bearer' };
    if (authType === 'headers') {
      const cleaned = cleanHeaders(headers);
      if (Object.keys(cleaned).length > 0) return { headers: cleaned, type: 'header' };
    }
    return undefined;
  };

  const identifier = () => name.toLowerCase().trim().replaceAll(/\s+/g, '-');

  /** HTTP + OAuth: create the connector, then run the authorize-code popup flow. */
  const handleOAuthAdd = async () => {
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
      const connectorId = await createConnector({
        identifier: identifier(),
        mcpConnectionType: 'http',
        mcpServerUrl: url.trim(),
        name: name.trim(),
        oidcConfig: {
          clientId: trimmedClientId || undefined,
          clientSecret: clientSecret.trim() || undefined,
          // client_id present → pre-registration; absent → dynamic client registration.
          scheme: trimmedClientId ? 'pre_registration' : 'dcr',
        },
        sourceType: ConnectorSourceType.custom,
      });

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

  /** No-auth / API key / custom headers / stdio: create then sync the tool list. */
  const handleDirectAdd = async () => {
    setSubmitting(true);
    try {
      const connectorId = await createConnector({
        credentials: buildCredentials(),
        identifier: identifier(),
        mcpConnectionType: mcpType,
        mcpServerUrl: mcpType === 'http' ? url.trim() : undefined,
        mcpStdioConfig:
          mcpType === 'stdio'
            ? { args, command: command.trim(), env: cleanHeaders(env) }
            : undefined,
        name: name.trim(),
        sourceType: ConnectorSourceType.custom,
      });

      try {
        await syncConnectorTools(connectorId);
        message.success(t('connector.add.success', 'Connector connected'));
      } catch (err: any) {
        message.error(
          t(
            'connector.add.syncToolsFailed',
            'Connector added, but tools could not be synced: {{reason}}',
            {
              reason: err?.message || t('connector.add.unknownError', 'unknown error'),
            },
          ),
        );
      }

      reset();
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const handleAdd = async () => {
    if (!canSubmit) return;
    if (mcpType === 'http' && authType === 'oauth') return handleOAuthAdd();
    return handleDirectAdd();
  };

  const handleCancel = () => {
    reset();
    onClose();
  };

  const labelStyle = { fontSize: 12, marginBottom: 4 } as const;

  return (
    <Modal
      cancelText={t('connector.add.cancel', 'Cancel')}
      confirmLoading={submitting}
      okButtonProps={{ disabled: !canSubmit }}
      okText={t('connector.add.confirm', 'Add')}
      open={open}
      title={t('connector.add.title', 'Add custom connector')}
      width={560}
      onCancel={handleCancel}
      onOk={handleAdd}
    >
      <Flexbox gap={12}>
        <div>
          <div style={labelStyle}>{t('dev.mcp.type.title', { ns: 'plugin' })}</div>
          <MCPTypeSelect value={mcpType} onChange={(v) => setMcpType(v as McpType)} />
        </div>

        <div>
          <div style={labelStyle}>{t('connector.add.name', 'Name')}</div>
          <Input
            placeholder={t('connector.add.namePlaceholder', 'My connector')}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        {mcpType === 'http' ? (
          <>
            <div>
              <div style={labelStyle}>{t('connector.add.url', 'Remote MCP server URL')}</div>
              <Input
                placeholder="https://mcp.example.com"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </div>

            <div>
              <div style={labelStyle}>{t('dev.mcp.auth.label', { ns: 'plugin' })}</div>
              <Radio.Group
                optionType="button"
                value={authType}
                options={[
                  { label: t('dev.mcp.auth.none', { ns: 'plugin' }), value: 'none' },
                  { label: t('connector.add.auth.apiKey', 'API Key'), value: 'apikey' },
                  { label: t('connector.add.auth.headers', 'Custom Headers'), value: 'headers' },
                  { label: t('connector.add.auth.oauth', 'OAuth'), value: 'oauth' },
                ]}
                onChange={(e) => setAuthType(e.target.value)}
              />
            </div>

            {authType === 'apikey' && (
              <div>
                <div style={labelStyle}>{t('connector.add.auth.token', 'Token')}</div>
                <InputPassword
                  placeholder={t('connector.add.auth.tokenPlaceholder', 'Bearer token / API key')}
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                />
              </div>
            )}

            {authType === 'headers' && (
              <div>
                <div style={labelStyle}>{t('dev.mcp.headers.label', { ns: 'plugin' })}</div>
                <KeyValueEditor
                  addButtonText={t('dev.mcp.headers.add', { ns: 'plugin' })}
                  value={headers}
                  onChange={setHeaders}
                />
              </div>
            )}

            {authType === 'oauth' && (
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
                  <Flexbox gap={8} style={{ marginTop: 8 }}>
                    <Input
                      placeholder={t('connector.add.clientId', 'OAuth Client ID (optional)')}
                      value={clientId}
                      onChange={(e) => setClientId(e.target.value)}
                    />
                    <InputPassword
                      placeholder={t(
                        'connector.add.clientSecret',
                        'OAuth Client Secret (optional)',
                      )}
                      value={clientSecret}
                      onChange={(e) => setClientSecret(e.target.value)}
                    />
                    <div style={{ color: 'var(--lobe-colors-neutral-500)', fontSize: 12 }}>
                      {t(
                        'connector.add.redirectHint',
                        'Redirect URI to register with your OAuth app:',
                      )}
                      <br />
                      <code style={{ wordBreak: 'break-all' }}>{redirectUri}</code>
                    </div>
                  </Flexbox>
                )}
              </div>
            )}
          </>
        ) : (
          <>
            <div>
              <div style={labelStyle}>{t('dev.mcp.command.label', { ns: 'plugin' })}</div>
              <MCPStdioCommandInput
                placeholder={t('dev.mcp.command.placeholder', { ns: 'plugin' })}
                value={command}
                onChange={(v) => setCommand((v as string) ?? '')}
              />
            </div>
            <div>
              <div style={labelStyle}>{t('dev.mcp.args.label', { ns: 'plugin' })}</div>
              <ArgsInput value={args} onChange={setArgs} />
            </div>
            <div>
              <div style={labelStyle}>{t('dev.mcp.env.label', { ns: 'plugin' })}</div>
              <KeyValueEditor
                addButtonText={t('dev.mcp.env.add', { ns: 'plugin' })}
                keyPlaceholder="VARIABLE_NAME"
                value={env}
                onChange={setEnv}
              />
            </div>
          </>
        )}
      </Flexbox>
    </Modal>
  );
});

AddConnectorModal.displayName = 'AddConnectorModal';

export default AddConnectorModal;

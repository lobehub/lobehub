'use client';

import { Alert, Flexbox, Icon, Tag } from '@lobehub/ui';
import { App, Button, Input, Switch, Typography } from 'antd';
import { createStyles } from 'antd-style';
import { ExternalLink, Info, RefreshCw, Save, Trash2 } from 'lucide-react';
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAppOrigin } from '@/hooks/useAppOrigin';
import { agentBotProviderService } from '@/services/agentBotProvider';

import { type IntegrationProvider } from './const';

const { Title, Text } = Typography;

const useStyles = createStyles(({ css, token }) => ({
  actionBar: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-block-start: 32px;
  `,
  content: css`
    display: flex;
    flex-direction: column;
    gap: 24px;

    width: 100%;
    max-width: 800px;
    margin-block: 0;
    margin-inline: auto;
    padding: 24px;
  `,
  field: css`
    display: flex;
    flex-direction: column;
    gap: 8px;
  `,
  header: css`
    position: sticky;
    z-index: 10;
    inset-block-start: 0;

    display: flex;
    justify-content: center;

    width: 100%;
    padding-block: 16px;
    padding-inline: 0;
    border-block-end: 1px solid ${token.colorBorder};

    background: ${token.colorBgContainer};
  `,
  headerContent: css`
    display: flex;
    align-items: center;
    justify-content: space-between;

    width: 100%;
    max-width: 800px;
    padding-block: 0;
    padding-inline: 24px;
  `,
  headerIcon: css`
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;

    width: 40px;
    height: 40px;

    color: ${token.colorText};
  `,
  helperLink: css`
    cursor: pointer;

    display: flex;
    gap: 4px;
    align-items: center;

    font-size: 12px;
    color: ${token.colorPrimary};
    text-decoration: none;

    &:hover {
      text-decoration: underline;
    }
  `,
  inputWrapper: css`
    position: relative;
  `,
  label: css`
    display: flex;
    align-items: center;
    justify-content: space-between;

    font-size: 14px;
    font-weight: 600;
    color: ${token.colorText};
  `,
  labelLeft: css`
    display: flex;
    gap: 8px;
    align-items: center;
  `,
  main: css`
    position: relative;

    overflow-y: auto;
    display: flex;
    flex: 1;
    flex-direction: column;

    background: ${token.colorBgContainer};
  `,
  passwordToggle: css`
    cursor: pointer;

    position: absolute;
    inset-block-start: 50%;
    inset-inline-end: 12px;
    transform: translateY(-50%);

    color: ${token.colorTextQuaternary};

    &:hover {
      color: ${token.colorTextSecondary};
    }
  `,
  section: css`
    display: flex;
    flex-direction: column;
    gap: 24px;
  `,
  sectionTitle: css`
    display: flex;
    gap: 8px;
    align-items: center;

    font-size: 12px;
    font-weight: 700;
    color: ${token.colorTextQuaternary};
    text-transform: uppercase;
    letter-spacing: 0.5px;

    &::before {
      content: '';

      display: block;

      width: 6px;
      height: 6px;
      border-radius: 50%;

      background: ${token.colorPrimary};
    }
  `,
  webhookBox: css`
    overflow: hidden;
    flex: 1;

    padding-block: 10px;
    padding-inline: 12px;
    border: 1px solid ${token.colorBorder};
    border-radius: ${token.borderRadius}px;

    font-family: monospace;
    font-size: 13px;
    color: ${token.colorTextSecondary};
    text-overflow: ellipsis;
    white-space: nowrap;

    background: ${token.colorFillQuaternary};
  `,
}));

interface CurrentConfig {
  applicationId: string;
  enabled: boolean;
  id: string;
  platform: string;
}

interface PlatformDetailProps {
  agentId: string;
  currentConfig?: CurrentConfig;
  onMutate: () => void;
  provider: IntegrationProvider;
}

const PlatformDetail = memo<PlatformDetailProps>(
  ({ provider, agentId, currentConfig, onMutate }) => {
    const { t } = useTranslation('agent');
    const { message: msg, modal } = App.useApp();
    const { styles, theme } = useStyles();
    const origin = useAppOrigin();

    const [formData, setFormData] = useState({
      applicationId: '',
      botToken: '',
      publicKey: '',
    });

    const [testing, setTesting] = useState(false);

    useEffect(() => {
      if (currentConfig) {
        setFormData({
          applicationId: currentConfig.applicationId || '',
          botToken: '',
          publicKey: '',
        });
      } else {
        setFormData({ applicationId: '', botToken: '', publicKey: '' });
      }
    }, [currentConfig, provider.id]);

    const handleSave = useCallback(async () => {
      if (!formData.applicationId || !formData.botToken) {
        msg.error('Please fill in Application ID and Token');
        return;
      }

      try {
        await agentBotProviderService.create({
          agentId,
          applicationId: formData.applicationId,
          credentials: {
            botToken: formData.botToken,
            publicKey: formData.publicKey || 'default',
          },
          platform: provider.id,
        });

        onMutate();
        msg.success(t('botProvider.createSuccess', 'Configuration saved successfully'));
      } catch (e) {
        console.error(e);
        msg.error('Failed to save configuration');
      }
    }, [agentId, provider.id, formData, onMutate, msg, t]);

    const handleDelete = useCallback(async () => {
      if (!currentConfig) return;

      modal.confirm({
        okButtonProps: { danger: true },
        okText: t('delete', 'Delete'),
        onOk: async () => {
          try {
            await agentBotProviderService.delete(currentConfig.id);
            onMutate();
            msg.success('Integration removed');
            setFormData({ applicationId: '', botToken: '', publicKey: '' });
          } catch {
            msg.error('Failed to remove integration');
          }
        },
        title: t('botProvider.deleteConfirm', 'Are you sure to remove this integration?'),
      });
    }, [currentConfig, onMutate, msg, t, modal]);

    const handleToggleEnable = useCallback(
      async (enabled: boolean) => {
        if (!currentConfig) return;
        try {
          await agentBotProviderService.update(currentConfig.id, { enabled });
          onMutate();
        } catch {
          msg.error('Failed to update status');
        }
      },
      [currentConfig, onMutate, msg],
    );

    const handleTestConnection = useCallback(async () => {
      if (!currentConfig) {
        msg.warning('Please save configuration first');
        return;
      }

      setTesting(true);
      try {
        await agentBotProviderService.connectBot({
          applicationId: currentConfig.applicationId,
          platform: provider.id,
        });
        msg.success(t('botProvider.connectSuccess', 'Connection test passed'));
      } catch {
        msg.error(t('botProvider.connectFailed', 'Connection test failed'));
      } finally {
        setTesting(false);
      }
    }, [currentConfig, provider.id, msg, t]);

    const ProviderIcon = provider.icon;

    return (
      <main className={styles.main}>
        {/* Header */}
        <header className={styles.header}>
          <div className={styles.headerContent}>
            <Flexbox horizontal align="center" gap={12}>
              <div className={styles.headerIcon}>
                <Icon icon={ProviderIcon} size={'large'} />
              </div>
              <div>
                <Flexbox horizontal align="center" gap={8}>
                  <Title level={4} style={{ margin: 0 }}>
                    {provider.name}
                  </Title>
                  <Tag>Bot</Tag>
                </Flexbox>
                <Text style={{ fontSize: 12 }} type="secondary">
                  {provider.description}
                </Text>
              </div>
            </Flexbox>

            {currentConfig && (
              <Flexbox horizontal align="center" gap={12}>
                <Text strong>{currentConfig.enabled ? 'Enabled' : 'Disabled'}</Text>
                <Switch checked={currentConfig.enabled} onChange={handleToggleEnable} />
              </Flexbox>
            )}
          </div>
        </header>

        {/* Content */}
        <div className={styles.content}>
          {/* Connection Config */}
          <div className={styles.section}>
            <div className={styles.sectionTitle}>Connection Configuration</div>

            <div className={styles.field}>
              <div className={styles.label}>
                <div className={styles.labelLeft}>
                  Application ID / Bot Username
                  {provider.fieldTags.appId && <Tag>{provider.fieldTags.appId}</Tag>}
                </div>
              </div>
              <Input
                placeholder="e.g. 1234567890"
                value={formData.applicationId}
                onChange={(e) => setFormData({ ...formData, applicationId: e.target.value })}
              />
            </div>

            <div className={styles.field}>
              <div className={styles.label}>
                <div className={styles.labelLeft}>
                  Bot Token / API Key
                  {provider.fieldTags.token && <Tag>{provider.fieldTags.token}</Tag>}
                </div>
                <a
                  className={styles.helperLink}
                  href={provider.docsLink}
                  rel="noreferrer"
                  target="_blank"
                >
                  How to get? <Icon icon={ExternalLink} size={'small'} />
                </a>
              </div>
              <Input.Password
                style={{ fontFamily: 'monospace' }}
                value={formData.botToken}
                placeholder={
                  currentConfig ? 'Token is hidden for security' : 'Paste your bot token here'
                }
                onChange={(e) => setFormData({ ...formData, botToken: e.target.value })}
              />
              <Text
                type="secondary"
                style={{
                  alignItems: 'center',
                  display: 'flex',
                  fontSize: 12,
                  gap: 4,
                }}
              >
                <Icon icon={Info} size={'small'} /> Token will be encrypted and stored securely.
              </Text>
            </div>

            {provider.fieldTags.publicKey && (
              <div className={styles.field}>
                <div className={styles.label}>
                  <div className={styles.labelLeft}>
                    Public Key
                    <Tag>{provider.fieldTags.publicKey}</Tag>
                  </div>
                </div>
                <Input
                  placeholder="Required for interaction verification"
                  style={{ fontFamily: 'monospace' }}
                  value={formData.publicKey}
                  onChange={(e) => setFormData({ ...formData, publicKey: e.target.value })}
                />
              </div>
            )}

            <div className={styles.field}>
              <div className={styles.label}>
                <div className={styles.labelLeft}>
                  Interaction Endpoint URL
                  {provider.fieldTags.webhook && <Tag>{provider.fieldTags.webhook}</Tag>}
                </div>
              </div>
              <Flexbox horizontal gap={8}>
                <div className={styles.webhookBox}>
                  {`${origin}/api/agent/webhooks/${provider.id}`}
                </div>
                <Button
                  onClick={() => {
                    navigator.clipboard.writeText(`${origin}/api/agent/webhooks/${provider.id}`);
                    msg.success('Copied to clipboard');
                  }}
                >
                  Copy
                </Button>
              </Flexbox>
              <Alert
                showIcon
                type="info"
                message={
                  <span>
                    Please copy this URL and paste it into the{' '}
                    <strong>&quot;Interactions Endpoint URL&quot;</strong> field in the{' '}
                    {provider.name} Developer Portal.
                  </span>
                }
              />
            </div>
          </div>

          <div style={{ background: theme.colorBorder, height: 1 }} />

          {/* Action Bar */}
          <div className={styles.actionBar}>
            {currentConfig ? (
              <Button danger icon={<Trash2 size={16} />} type="text" onClick={handleDelete}>
                Remove Integration
              </Button>
            ) : (
              <div /> // Spacer
            )}

            <Flexbox horizontal gap={12}>
              <Button
                icon={<RefreshCw size={16} />}
                loading={testing}
                onClick={handleTestConnection}
              >
                Test Connection
              </Button>
              <Button icon={<Save size={16} />} type="primary" onClick={handleSave}>
                Save Configuration
              </Button>
            </Flexbox>
          </div>
        </div>
      </main>
    );
  },
);

export default PlatformDetail;

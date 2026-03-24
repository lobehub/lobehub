'use client';

import { Alert, Flexbox, Tag } from '@lobehub/ui';
import { Button, Form as AntdForm, type FormInstance } from 'antd';
import { createStaticStyles } from 'antd-style';
import { RefreshCw, Save, Trash2 } from 'lucide-react';
import { memo } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { useAppOrigin } from '@/hooks/useAppOrigin';
import type { SerializedPlatformDefinition } from '@/server/services/bot/platforms/types';

import type { ChannelFormValues, TestResult } from './index';

const styles = createStaticStyles(({ css, cssVar }) => ({
  actionBar: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-block-start: 16px;
  `,
  bottom: css`
    display: flex;
    flex-direction: column;
    gap: 16px;

    width: 100%;
    max-width: 1024px;
  `,
  webhookBox: css`
    overflow: hidden;
    flex: 1;

    height: ${cssVar.controlHeight};
    padding-inline: 12px;
    border: 1px solid ${cssVar.colorBorder};
    border-radius: ${cssVar.borderRadius};

    font-family: monospace;
    font-size: 13px;
    line-height: ${cssVar.controlHeight};
    color: ${cssVar.colorTextSecondary};
    text-overflow: ellipsis;
    white-space: nowrap;

    background: ${cssVar.colorFillQuaternary};
  `,
}));

interface FooterProps {
  connecting: boolean;
  connectResult?: TestResult;
  form: FormInstance<ChannelFormValues>;
  hasConfig: boolean;
  onCopied: () => void;
  onDelete: () => void;
  onSave: () => void;
  onTestConnection: () => void;
  platformDef: SerializedPlatformDefinition;
  saveResult?: TestResult;
  saving: boolean;
  testing: boolean;
  testResult?: TestResult;
}

const Footer = memo<FooterProps>(
  ({
    platformDef,
    form,
    hasConfig,
    connectResult,
    connecting,
    saveResult,
    saving,
    testing,
    testResult,
    onSave,
    onDelete,
    onTestConnection,
    onCopied,
  }) => {
    const { t } = useTranslation('agent');
    const origin = useAppOrigin();
    const platformId = platformDef.id;
    const applicationId = AntdForm.useWatch('applicationId', form);

    const webhookUrl = applicationId
      ? `${origin}/api/agent/webhooks/${platformId}/${applicationId}`
      : `${origin}/api/agent/webhooks/${platformId}`;

    return (
      <div className={styles.bottom}>
        <div className={styles.actionBar}>
          {hasConfig ? (
            <Button
              danger
              disabled={saving || connecting}
              icon={<Trash2 size={16} />}
              type="primary"
              onClick={onDelete}
            >
              {t('channel.removeChannel')}
            </Button>
          ) : (
            <div />
          )}
          <Flexbox horizontal gap={12}>
            {hasConfig && (
              <Button
                disabled={saving || connecting}
                icon={<RefreshCw size={16} />}
                loading={testing}
                onClick={onTestConnection}
              >
                {t('channel.testConnection')}
              </Button>
            )}
            <Button
              icon={<Save size={16} />}
              loading={saving || connecting}
              type="primary"
              onClick={onSave}
            >
              {connecting ? t('channel.connecting') : t('channel.save')}
            </Button>
          </Flexbox>
        </div>

        {saveResult && (
          <Alert
            closable
            showIcon
            description={saveResult.type === 'error' ? saveResult.errorDetail : undefined}
            title={saveResult.type === 'success' ? t('channel.saved') : t('channel.saveFailed')}
            type={saveResult.type}
          />
        )}

        {connectResult && (
          <Alert
            closable
            showIcon
            description={connectResult.type === 'error' ? connectResult.errorDetail : undefined}
            type={connectResult.type}
            title={
              connectResult.title ||
              (connectResult.type === 'success'
                ? t('channel.connectSuccess')
                : t('channel.connectFailed'))
            }
          />
        )}

        {testResult && (
          <Alert
            closable
            showIcon
            description={testResult.type === 'error' ? testResult.errorDetail : undefined}
            type={testResult.type}
            title={
              testResult.type === 'success' ? t('channel.testSuccess') : t('channel.testFailed')
            }
          />
        )}

        {hasConfig && platformDef.showWebhookUrl && (
          <Flexbox gap={8}>
            <Flexbox horizontal align="center" gap={8}>
              <span style={{ fontWeight: 600 }}>{t('channel.endpointUrl')}</span>
              <Tag>{'Event Subscription URL'}</Tag>
            </Flexbox>
            <Flexbox horizontal gap={8}>
              <div className={styles.webhookBox}>{webhookUrl}</div>
              <Button
                onClick={() => {
                  navigator.clipboard.writeText(webhookUrl);
                  onCopied();
                }}
              >
                {t('channel.copy')}
              </Button>
            </Flexbox>
            <Alert
              showIcon
              type="info"
              message={
                <Trans
                  components={{ bold: <strong /> }}
                  i18nKey="channel.endpointUrlHint"
                  ns="agent"
                  values={{ fieldName: 'Event Subscription URL', name: platformDef.name }}
                />
              }
            />
          </Flexbox>
        )}
      </div>
    );
  },
);

export default Footer;

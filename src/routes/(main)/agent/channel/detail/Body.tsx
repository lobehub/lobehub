'use client';

import {
  Alert,
  Flexbox,
  Form,
  type FormGroupItemType,
  type FormItemProps,
  Icon,
  Tag,
} from '@lobehub/ui';
import { Button, Form as AntdForm, type FormInstance, Switch } from 'antd';
import { createStaticStyles } from 'antd-style';
import { RefreshCw, Save, Trash2 } from 'lucide-react';
import { memo } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { useAppOrigin } from '@/hooks/useAppOrigin';

import { type ChannelProvider } from '../const';
import type { ChannelFormValues, TestResult } from './index';
import { getDiscordFormItems } from './platforms/discord';
import { getFeishuFormItems } from './platforms/feishu';
import { getLarkFormItems } from './platforms/lark';
import { getTelegramFormItems } from './platforms/telegram';

const prefixCls = 'ant';

const styles = createStaticStyles(({ css, cssVar }) => ({
  actionBar: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-block-start: 16px;
  `,
  form: css`
    .${prefixCls}-form-item-control:has(.${prefixCls}-input, .${prefixCls}-select) {
      flex: none;
    }
  `,
  bottom: css`
    display: flex;
    flex-direction: column;
    gap: 16px;

    width: 100%;
    max-width: 1024px;
    margin-block: 0;
    margin-inline: auto;
    padding-block: 0 24px;
    padding-inline: 24px;
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

const platformFormItemsMap: Record<
  string,
  (t: any, hasConfig: boolean, provider: ChannelProvider) => FormItemProps[]
> = {
  discord: getDiscordFormItems,
  feishu: getFeishuFormItems,
  lark: getLarkFormItems,
  telegram: getTelegramFormItems,
};

interface BodyProps {
  currentConfig?: { enabled: boolean };
  form: FormInstance<ChannelFormValues>;
  hasConfig: boolean;
  onCopied: () => void;
  onDelete: () => void;
  onSave: () => void;
  onTestConnection: () => void;
  onToggleEnable: (enabled: boolean) => void;
  provider: ChannelProvider;
  saveResult?: TestResult;
  saving: boolean;
  testing: boolean;
  testResult?: TestResult;
}

const Body = memo<BodyProps>(
  ({
    provider,
    form,
    hasConfig,
    currentConfig,
    saveResult,
    saving,
    testing,
    testResult,
    onSave,
    onDelete,
    onTestConnection,
    onToggleEnable,
    onCopied,
  }) => {
    const { t } = useTranslation('agent');
    const origin = useAppOrigin();
    const applicationId = AntdForm.useWatch('applicationId', form);

    const webhookUrl = applicationId
      ? `${origin}/api/agent/webhooks/${provider.id}/${applicationId}`
      : `${origin}/api/agent/webhooks/${provider.id}`;

    const getItems = platformFormItemsMap[provider.id];
    const configItems = getItems ? getItems(t, hasConfig, provider) : [];

    const headerTitle = (
      <Flexbox horizontal align="center" gap={8}>
        <Flexbox
          align="center"
          justify="center"
          style={{
            background: provider.color,
            borderRadius: 10,
            flexShrink: 0,
            height: 32,
            width: 32,
          }}
        >
          <Icon fill="white" icon={provider.icon} size="middle" />
        </Flexbox>
        {provider.name}
      </Flexbox>
    );

    const headerExtra = currentConfig ? (
      <Switch checked={currentConfig.enabled} onChange={onToggleEnable} />
    ) : undefined;

    const group: FormGroupItemType = {
      children: configItems,
      defaultActive: true,
      extra: headerExtra,
      title: headerTitle,
    };

    return (
      <>
        <Form
          className={styles.form}
          form={form}
          itemMinWidth={'max(50%, 400px)'}
          items={[group]}
          requiredMark={false}
          style={{ maxWidth: 1024, padding: 24, width: '100%' }}
          variant={'borderless'}
        />

        <div className={styles.bottom}>
          <div className={styles.actionBar}>
            {hasConfig ? (
              <Button danger icon={<Trash2 size={16} />} type="primary" onClick={onDelete}>
                {t('channel.removeChannel')}
              </Button>
            ) : (
              <div />
            )}
            <Flexbox horizontal gap={12}>
              {hasConfig && (
                <Button icon={<RefreshCw size={16} />} loading={testing} onClick={onTestConnection}>
                  {t('channel.testConnection')}
                </Button>
              )}
              <Button icon={<Save size={16} />} loading={saving} type="primary" onClick={onSave}>
                {t('channel.save')}
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

          {hasConfig && provider.webhookMode !== 'auto' && (
            <Flexbox gap={8}>
              <Flexbox horizontal align="center" gap={8}>
                <span style={{ fontWeight: 600 }}>{t('channel.endpointUrl')}</span>
                {provider.fieldTags.webhook && <Tag>{provider.fieldTags.webhook}</Tag>}
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
                    values={{ fieldName: provider.fieldTags.webhook, name: provider.name }}
                  />
                }
              />
            </Flexbox>
          )}
        </div>
      </>
    );
  },
);

export default Body;

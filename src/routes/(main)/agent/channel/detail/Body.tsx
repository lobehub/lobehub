'use client';

import { Alert, Flexbox, Form, type FormGroupItemType, type FormItemProps, Tag } from '@lobehub/ui';
import { Button, Form as AntdForm, type FormInstance, InputNumber, Select, Switch } from 'antd';
import { createStaticStyles } from 'antd-style';
import { RefreshCw, Save, Trash2 } from 'lucide-react';
import { memo, useMemo } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { FormInput, FormPassword } from '@/components/FormInput';
import InfoTooltip from '@/components/InfoTooltip';
import { useAppOrigin } from '@/hooks/useAppOrigin';
import type {
  FieldSchema,
  SerializedPlatformDefinition,
} from '@/server/services/bot/platforms/types';

import { getPlatformIcon, PLATFORM_UI } from '../const';
import type { ChannelFormValues, TestResult } from './index';

const prefixCls = 'ant';

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
    margin-block: 0;
    margin-inline: auto;
    padding-block: 0 24px;
    padding-inline: 24px;
  `,
  form: css`
    .${prefixCls}-form-item-control:has(.${prefixCls}-input, .${prefixCls}-select, .${prefixCls}-input-number) {
      flex: none;
    }
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

// --------------- Field → FormItem renderer ---------------

function renderFieldComponent(field: FieldSchema, hasConfig: boolean): React.ReactNode {
  switch (field.type) {
    case 'password': {
      return (
        <FormPassword
          autoComplete="new-password"
          placeholder={field.placeholder || (hasConfig ? '••••••••' : undefined)}
        />
      );
    }
    case 'boolean': {
      return <Switch />;
    }
    case 'number':
    case 'integer': {
      return (
        <InputNumber
          max={field.maximum}
          min={field.minimum}
          placeholder={field.placeholder}
          style={{ width: '100%' }}
        />
      );
    }
    case 'string': {
      if (field.enum) {
        return (
          <Select
            placeholder={field.placeholder}
            options={field.enum.map((value, i) => ({
              label: field.enumLabels?.[i] || value,
              value,
            }))}
          />
        );
      }
      return <FormInput placeholder={field.placeholder || field.label} />;
    }
    default: {
      return <FormInput placeholder={field.placeholder || field.label} />;
    }
  }
}

function fieldToFormItem(field: FieldSchema, hasConfig: boolean): FormItemProps {
  return {
    children: renderFieldComponent(field, hasConfig),
    desc: field.description,
    label: field.label,
    name: field.key,
    rules: field.required ? [{ required: true }] : undefined,
    tag: field.label,
    valuePropName: field.type === 'boolean' ? 'checked' : undefined,
  };
}

// --------------- Build form groups ---------------

function buildCredentialItems(fields: FieldSchema[], hasConfig: boolean): FormItemProps[] {
  return fields
    .filter((f) => !f.devOnly || process.env.NODE_ENV === 'development')
    .map((f) => fieldToFormItem(f, hasConfig));
}

function buildSettingsGroups(fields: FieldSchema[], hasConfig: boolean): FormGroupItemType[] {
  const grouped = new Map<string, FieldSchema[]>();

  for (const field of fields) {
    if (field.devOnly && process.env.NODE_ENV !== 'development') continue;
    const groupKey = field.group || 'general';
    const list = grouped.get(groupKey) || [];
    list.push(field);
    grouped.set(groupKey, list);
  }

  return [...grouped.entries()].map(([key, groupFields]) => ({
    children: groupFields.flatMap((f) => {
      if (f.type === 'object' && f.properties) {
        // Flatten nested object fields with dot-path names
        return f.properties.map((child) => fieldToFormItem(child, hasConfig));
      }
      return fieldToFormItem(f, hasConfig);
    }),
    defaultActive: true,
    key,
    title: key.charAt(0).toUpperCase() + key.slice(1),
  }));
}

// --------------- Body component ---------------

interface BodyProps {
  currentConfig?: { enabled: boolean };
  form: FormInstance<ChannelFormValues>;
  hasConfig: boolean;
  onCopied: () => void;
  onDelete: () => void;
  onSave: () => void;
  onTestConnection: () => void;
  onToggleEnable: (enabled: boolean) => void;
  platformDef: SerializedPlatformDefinition;
  saveResult?: TestResult;
  saving: boolean;
  testing: boolean;
  testResult?: TestResult;
}

const Body = memo<BodyProps>(
  ({
    platformDef,
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
    const platformId = platformDef.id;
    const platformName = platformDef.name;
    const applicationId = AntdForm.useWatch('applicationId', form);

    const webhookUrl = applicationId
      ? `${origin}/api/agent/webhooks/${platformId}/${applicationId}`
      : `${origin}/api/agent/webhooks/${platformId}`;

    const ui = PLATFORM_UI[platformId];
    const PlatformIcon = getPlatformIcon(platformName);
    const ColorIcon =
      PlatformIcon && 'Color' in PlatformIcon ? (PlatformIcon as any).Color : PlatformIcon;

    const headerTitle = (
      <Flexbox horizontal align="center" gap={8}>
        {ColorIcon && <ColorIcon size={32} />}
        {platformName}
        {platformDef.documentation?.setupGuideUrl && (
          <a
            href={platformDef.documentation.setupGuideUrl}
            rel="noopener noreferrer"
            target="_blank"
            onClick={(e) => e.stopPropagation()}
          >
            <InfoTooltip title={t('channel.setupGuide')} />
          </a>
        )}
      </Flexbox>
    );

    const headerExtra = currentConfig ? (
      <Switch checked={currentConfig.enabled} onChange={onToggleEnable} />
    ) : undefined;

    const formGroups = useMemo<FormGroupItemType[]>(() => {
      // Credentials group
      const credentialGroup: FormGroupItemType = {
        children: buildCredentialItems(platformDef.credentials, hasConfig),
        defaultActive: true,
        extra: headerExtra,
        title: headerTitle,
      };

      // Settings groups
      const settingsGroups = platformDef.settings
        ? buildSettingsGroups(platformDef.settings, hasConfig)
        : [];

      return [credentialGroup, ...settingsGroups];
    }, [platformDef, hasConfig, headerTitle, headerExtra]);

    return (
      <>
        <Form
          className={styles.form}
          form={form}
          itemMinWidth={'max(50%, 400px)'}
          items={formGroups}
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

          {hasConfig && ui?.webhookMode !== 'auto' && (
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
      </>
    );
  },
);

export default Body;

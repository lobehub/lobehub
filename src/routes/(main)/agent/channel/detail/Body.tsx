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

function renderFieldComponent(
  field: FieldSchema,
  hasConfig: boolean,
  t: (key: string) => string,
): React.ReactNode {
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
              label: field.enumLabels?.[i] ? t(field.enumLabels[i]) : value,
              value,
            }))}
          />
        );
      }
      return <FormInput placeholder={field.placeholder || t(field.label)} />;
    }
    default: {
      return <FormInput placeholder={field.placeholder || t(field.label)} />;
    }
  }
}

function fieldToFormItem(
  field: FieldSchema,
  hasConfig: boolean,
  t: (key: string) => string,
  parentKey?: string,
): FormItemProps {
  const label = field.devOnly ? (
    <Flexbox horizontal align="center" gap={8}>
      {t(field.label)}
      <Tag color="gold">Dev Only</Tag>
    </Flexbox>
  ) : (
    t(field.label)
  );

  return {
    children: renderFieldComponent(field, hasConfig, t),
    desc: field.description ? t(field.description) : undefined,
    initialValue: field.default,
    label,
    name: parentKey ? [parentKey, field.key] : field.key,
    rules: field.required ? [{ required: true }] : undefined,
    tag: field.key,
    valuePropName: field.type === 'boolean' ? 'checked' : undefined,
  };
}

// --------------- Build form groups ---------------

/**
 * Build form groups from schema.
 *
 * Schema has two top-level objects: `credentials` and `settings`.
 * - `credentials` properties → first form group (expanded, title set by caller)
 * - `settings` properties → single collapsed group
 */
function buildFormGroups(
  schema: FieldSchema[],
  hasConfig: boolean,
  t: (key: string) => string,
  headerTitle: React.ReactNode,
  headerExtra?: React.ReactNode,
): FormGroupItemType[] {
  const groups: FormGroupItemType[] = [];

  const credentialsSchema = schema.find((f) => f.key === 'credentials');
  const settingsSchema = schema.find((f) => f.key === 'settings');

  // Credentials group
  if (credentialsSchema?.properties) {
    const items = credentialsSchema.properties
      .filter((f) => !f.devOnly || process.env.NODE_ENV === 'development')
      .map((f) => fieldToFormItem(f, hasConfig, t, 'credentials'));

    groups.push({
      children: items,
      defaultActive: true,
      extra: headerExtra,
      key: 'credentials',
      title: headerTitle,
    });
  }

  // Settings — single collapsed group
  if (settingsSchema?.properties) {
    const items = settingsSchema.properties
      .filter((f) => !f.devOnly || process.env.NODE_ENV === 'development')
      .flatMap((f) => {
        if (f.type === 'object' && f.properties) {
          return f.properties.map((child) => fieldToFormItem(child, hasConfig, t, 'settings'));
        }
        return fieldToFormItem(f, hasConfig, t, 'settings');
      });

    groups.push({
      children: items,
      collapsible: true,
      defaultActive: false,
      key: 'settings',
      title: t(settingsSchema.label),
    });
  }

  return groups;
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
    const applicationId = AntdForm.useWatch(['credentials', 'applicationId'], form);

    const webhookUrl = applicationId
      ? `${origin}/api/agent/webhooks/${platformId}/${applicationId}`
      : `${origin}/api/agent/webhooks/${platformId}`;

    const ui = PLATFORM_UI[platformId];
    const PlatformIcon = getPlatformIcon(platformName);
    const ColorIcon =
      PlatformIcon && 'Color' in PlatformIcon ? (PlatformIcon as any).Color : PlatformIcon;

    const formGroups = useMemo<FormGroupItemType[]>(() => {
      const title = (
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

      const extra = currentConfig ? (
        <Switch checked={currentConfig.enabled} onChange={onToggleEnable} />
      ) : undefined;

      return buildFormGroups(platformDef.schema, hasConfig, t, title, extra);
    }, [platformDef, hasConfig, currentConfig, onToggleEnable, ColorIcon, platformName, t]);

    return (
      <>
        <Form
          className={styles.form}
          form={form}
          gap={16}
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

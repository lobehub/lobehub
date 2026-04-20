'use client';

import { Flexbox, Form, FormGroup, FormItem, Tag } from '@lobehub/ui';
import {
  Button,
  Form as AntdForm,
  type FormInstance,
  InputNumber,
  Popconfirm,
  Select,
  Switch,
} from 'antd';
import { createStaticStyles } from 'antd-style';
import { RotateCcw } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FormInput, FormPassword } from '@/components/FormInput';
import type {
  FieldSchema,
  SerializedPlatformDefinition,
} from '@/server/services/bot/platforms/types';
import { isDev } from '@/utils/env';

import { platformCredentialBodyMap } from '../platform/registry';
import type { ChannelFormValues } from './index';

const prefixCls = 'ant';

const styles = createStaticStyles(({ css }) => ({
  form: css`
    .${prefixCls}-form-item-control {
      flex: 0 0 50% !important;
      width: 50%;
    }
  `,
}));

// --------------- Validation rules builder ---------------

function buildRules(field: FieldSchema, t: (key: string) => string) {
  const rules: any[] = [];

  if (field.required) {
    rules.push({ message: t(field.label), required: true });
  }

  if (field.type === 'number' || field.type === 'integer') {
    if (typeof field.minimum === 'number') {
      rules.push({
        message: `${t(field.label)} ≥ ${field.minimum}`,
        min: field.minimum,
        type: 'number' as const,
      });
    }
    if (typeof field.maximum === 'number') {
      rules.push({
        message: `${t(field.label)} ≤ ${field.maximum}`,
        max: field.maximum,
        type: 'number' as const,
      });
    }
  }

  return rules.length > 0 ? rules : undefined;
}

// --------------- Single field component (memo'd) ---------------

interface SchemaFieldProps {
  divider?: boolean;
  field: FieldSchema;
  parentKey: string;
}

const SchemaField = memo<SchemaFieldProps>(({ field, parentKey, divider }) => {
  const { t: _t } = useTranslation('agent');
  const t = _t as (key: string) => string;

  // Conditional visibility: watch the sibling field specified by visibleWhen
  const watchedValue = AntdForm.useWatch(
    field.visibleWhen ? [parentKey, field.visibleWhen.field] : [],
  );
  if (field.visibleWhen && watchedValue !== field.visibleWhen.value) return null;

  const label = field.devOnly ? (
    <Flexbox horizontal align="center" gap={8}>
      {t(field.label)}
      <Tag color="gold">Dev Only</Tag>
    </Flexbox>
  ) : (
    t(field.label)
  );

  let children: React.ReactNode;
  switch (field.type) {
    case 'password': {
      children = <FormPassword autoComplete="new-password" placeholder={field.placeholder} />;
      break;
    }
    case 'boolean': {
      children = <Switch />;
      break;
    }
    case 'number':
    case 'integer': {
      children = (
        <InputNumber
          max={field.maximum}
          min={field.minimum}
          placeholder={field.placeholder}
          style={{ width: '100%' }}
        />
      );
      break;
    }
    case 'string': {
      if (field.enum) {
        children = (
          <Select
            placeholder={field.placeholder}
            options={field.enum.map((value, i) => ({
              label: field.enumLabels?.[i] ? t(field.enumLabels[i]) : value,
              value,
            }))}
          />
        );
      } else {
        children = <FormInput placeholder={field.placeholder || t(field.label)} />;
      }
      break;
    }
    default: {
      children = <FormInput placeholder={field.placeholder || t(field.label)} />;
    }
  }

  return (
    <FormItem
      desc={field.description ? t(field.description) : undefined}
      divider={divider}
      initialValue={field.default}
      label={label}
      minWidth={'max(50%, 400px)'}
      name={[parentKey, field.key]}
      rules={buildRules(field, t)}
      tag={isDev ? field.key : undefined}
      valuePropName={field.type === 'boolean' ? 'checked' : undefined}
      variant="borderless"
    >
      {children}
    </FormItem>
  );
});

// --------------- ApplicationId field (standalone, not nested) ---------------

const ApplicationIdField = memo<{ field: FieldSchema }>(({ field }) => {
  const { t: _t } = useTranslation('agent');
  const t = _t as (key: string) => string;

  return (
    <FormItem
      desc={field.description ? t(field.description) : undefined}
      initialValue={field.default}
      label={t(field.label)}
      minWidth={'max(50%, 400px)'}
      name="applicationId"
      rules={field.required ? [{ message: t(field.label), required: true }] : undefined}
      tag={isDev ? 'applicationId' : undefined}
      variant="borderless"
    >
      <FormInput placeholder={field.placeholder || t(field.label)} />
    </FormItem>
  );
});

// --------------- Helper: flatten fields from schema ---------------

function getFields(schema: FieldSchema[], sectionKey: string): FieldSchema[] {
  const section = schema.find((f) => f.key === sectionKey);
  if (!section?.properties) return [];

  return section.properties
    .filter((f) => !f.devOnly || process.env.NODE_ENV === 'development')
    .flatMap((f) => {
      if (f.type === 'object' && f.properties) {
        return f.properties.filter(
          (child) => !child.devOnly || process.env.NODE_ENV === 'development',
        );
      }
      return f;
    });
}

// --------------- Settings group title (memo'd) ---------------

const SettingsTitle = memo<{ schema: FieldSchema[] }>(({ schema }) => {
  const { t: _t } = useTranslation('agent');
  const t = _t as (key: string) => string;
  const settingsSchema = schema.find((f) => f.key === 'settings');
  return <>{settingsSchema ? t(settingsSchema.label) : null}</>;
});

// --------------- Body component ---------------

interface BodyProps {
  currentConfig?: {
    applicationId: string;
    credentials: Record<string, string>;
    settings?: Record<string, unknown> | null;
  };
  form: FormInstance<ChannelFormValues>;
  hasConfig?: boolean;
  onAuthenticated?: (params: {
    applicationId: string;
    credentials: Record<string, string>;
  }) => void;
  platformDef: SerializedPlatformDefinition;
}

const Body = memo<BodyProps>(({ platformDef, form, hasConfig, currentConfig, onAuthenticated }) => {
  const { t: _t } = useTranslation('agent');
  const t = _t as (key: string) => string;

  const CustomCredentialBody = platformCredentialBodyMap[platformDef.id];

  const applicationIdField = useMemo(
    () => platformDef.schema.find((f) => f.key === 'applicationId'),
    [platformDef.schema],
  );

  const credentialFields = useMemo(
    () => getFields(platformDef.schema, 'credentials'),
    [platformDef.schema],
  );

  const settingsFields = useMemo(
    () => getFields(platformDef.schema, 'settings'),
    [platformDef.schema],
  );

  const [settingsActive, setSettingsActive] = useState(false);

  const handleResetSettings = useCallback(() => {
    const defaults: Record<string, any> = {};
    for (const field of settingsFields) {
      if (field.default !== undefined) {
        defaults[field.key] = field.default;
      }
    }
    form.setFieldsValue({ settings: defaults });
  }, [form, settingsFields]);

  return (
    <Form
      className={styles.form}
      form={form}
      gap={0}
      itemMinWidth={'max(50%, 400px)'}
      requiredMark={false}
      style={{ maxWidth: 1024, padding: '16px 0', width: '100%' }}
      variant={'borderless'}
    >
      {CustomCredentialBody ? (
        <CustomCredentialBody
          currentConfig={currentConfig}
          hasConfig={hasConfig}
          onAuthenticated={onAuthenticated}
        />
      ) : (
        <>
          {applicationIdField && <ApplicationIdField field={applicationIdField} />}
          {credentialFields.map((field, i) => (
            <SchemaField
              divider={applicationIdField ? true : i !== 0}
              field={field}
              key={field.key}
              parentKey="credentials"
            />
          ))}
        </>
      )}
      {settingsFields.length > 0 && (
        <FormGroup
          collapsible
          defaultActive={false}
          keyValue={`settings-${platformDef.id}`}
          style={{ marginBlockStart: 16 }}
          title={<SettingsTitle schema={platformDef.schema} />}
          variant="borderless"
          extra={
            settingsActive ? (
              <Popconfirm title={t('channel.settingsResetConfirm')} onConfirm={handleResetSettings}>
                <Button icon={<RotateCcw size={14} />} size="small" type="default">
                  {t('channel.settingsResetDefault')}
                </Button>
              </Popconfirm>
            ) : undefined
          }
          onCollapse={setSettingsActive}
        >
          {settingsFields.map((field, i) => (
            <SchemaField divider={i !== 0} field={field} key={field.key} parentKey="settings" />
          ))}
        </FormGroup>
      )}
    </Form>
  );
});

export default Body;

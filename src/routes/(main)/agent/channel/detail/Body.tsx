'use client';

import { Flexbox, Form, FormGroup, FormItem, Tag, Text } from '@lobehub/ui';
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
import { Plus, RotateCcw, Trash2 } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FormInput, FormPassword } from '@/components/FormInput';
import type {
  FieldSchema,
  SerializedPlatformDefinition,
} from '@/server/services/bot/platforms/types';
import { isDev } from '@/utils/env';

import { platformCredentialBodyMap } from '../platform/registry';
import { extractSettingsDefaults } from './formState';
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

  // Array of objects (e.g. user / channel allowlist) — needs Form.List, can't
  // be expressed as a single control inside a name-bound FormItem.
  if (field.type === 'array' && field.items?.type === 'object') {
    return <ObjectListField divider={divider} field={field} label={label} parentKey={parentKey} />;
  }

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
        const hasDescriptions = field.enumDescriptions?.some(Boolean);
        children = (
          <Select
            placeholder={field.placeholder}
            optionRender={
              hasDescriptions
                ? (item) => (
                    <Flexbox horizontal align="center" gap={12} justify="space-between">
                      <span>{item.label}</span>
                      {item.data.description ? (
                        <Text fontSize={12} type="secondary">
                          {item.data.description}
                        </Text>
                      ) : null}
                    </Flexbox>
                  )
                : undefined
            }
            options={field.enum.map((value, i) => ({
              description: field.enumDescriptions?.[i] ? t(field.enumDescriptions[i]) : undefined,
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

// --------------- Object-list field (e.g. allowFrom: [{id, name?}]) ---------------

interface ObjectListFieldProps {
  divider?: boolean;
  field: FieldSchema;
  label: React.ReactNode;
  parentKey: string;
}

const ObjectListField = memo<ObjectListFieldProps>(({ field, parentKey, divider, label }) => {
  const { t: _t } = useTranslation('agent');
  const t = _t as (key: string) => string;

  // The runtime ignores anything beyond `id`, but the editor renders every
  // declared property so future additions (e.g. a per-row note tag) flow
  // through without code changes here.
  const itemProps = field.items?.type === 'object' ? (field.items.properties ?? []) : [];

  // Convention: the schema field key drives the per-list copy keys
  // (`allowFrom` → `channel.allowFromAdd` / `channel.allowFromEmpty`).
  // Avoids overloading FieldSchema with cosmetic strings while keeping each
  // list's "Add user" / "Add channel" wording distinct.
  const addLabel = t(`${field.label}Add` as 'channel.allowFromAdd');
  const emptyLabel = t(`${field.label}Empty` as 'channel.allowFromEmpty');
  const removeLabel = t('channel.allowListRemove');

  return (
    <FormItem
      desc={field.description ? t(field.description) : undefined}
      divider={divider}
      label={label}
      minWidth={'max(50%, 400px)'}
      tag={isDev ? field.key : undefined}
      variant="borderless"
    >
      <AntdForm.List initialValue={field.default as unknown[]} name={[parentKey, field.key]}>
        {(rows, { add, remove }) => (
          <Flexbox gap={8} style={{ width: '100%' }}>
            {rows.length === 0 && (
              <Flexbox style={{ fontSize: 12, opacity: 0.6, paddingBlock: 4 }}>
                {emptyLabel}
              </Flexbox>
            )}
            {rows.map(({ key, name }) => (
              <Flexbox horizontal align="center" gap={8} key={key}>
                {itemProps.map((sub) => (
                  // `noStyle` skips the antd FormItem chrome that the parent
                  // form's 50%-width override targets — without it each cell
                  // collapses to half the row, leaving a wide gap between
                  // the id and name inputs. The flex:1 wrapper takes over
                  // sizing, and `minWidth:0` lets the input actually shrink.
                  <div key={sub.key} style={{ flex: 1, minWidth: 0 }}>
                    <AntdForm.Item
                      noStyle
                      name={[name, sub.key]}
                      rules={
                        sub.required
                          ? [{ message: t(sub.label), required: true, whitespace: true }]
                          : undefined
                      }
                    >
                      <FormInput
                        placeholder={
                          sub.placeholder
                            ? t(sub.placeholder as 'channel.allowFromIdPlaceholder')
                            : t(sub.label)
                        }
                      />
                    </AntdForm.Item>
                  </div>
                ))}
                <Button
                  aria-label={removeLabel}
                  icon={<Trash2 size={14} />}
                  type="text"
                  onClick={() => remove(name)}
                />
              </Flexbox>
            ))}
            <Button
              block
              icon={<Plus size={14} />}
              type="dashed"
              onClick={() => add({ id: '', name: '' })}
            >
              {addLabel}
            </Button>
          </Flexbox>
        )}
      </AntdForm.List>
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
    form.setFieldsValue({
      settings: extractSettingsDefaults(platformDef.schema) as Record<string, {} | undefined>,
    });
  }, [form, platformDef.schema]);

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

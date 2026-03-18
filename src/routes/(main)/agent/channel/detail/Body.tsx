'use client';

import {
  Flexbox,
  Form,
  FormGroup,
  type FormGroupItemType,
  FormItem,
  type FormItemProps,
  Tag,
} from '@lobehub/ui';
import { type FormInstance, InputNumber, Select, Switch } from 'antd';
import { createStaticStyles } from 'antd-style';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { FormInput, FormPassword } from '@/components/FormInput';
import type {
  FieldSchema,
  SerializedPlatformDefinition,
} from '@/server/services/bot/platforms/types';

import type { ChannelFormValues } from './index';

const prefixCls = 'ant';

const styles = createStaticStyles(({ css }) => ({
  form: css`
    .${prefixCls}-form-item-control:has(.${prefixCls}-input, .${prefixCls}-select, .${prefixCls}-input-number) {
      flex: none;
    }
  `,
}));

// --------------- Field → FormItem renderer ---------------

function renderFieldComponent(field: FieldSchema, t: (key: string) => string): React.ReactNode {
  switch (field.type) {
    case 'password': {
      return <FormPassword autoComplete="new-password" placeholder={field.placeholder} />;
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
    children: renderFieldComponent(field, t),
    desc: field.description ? t(field.description) : undefined,
    initialValue: field.default,
    label,
    name: parentKey ? [parentKey, field.key] : field.key,
    rules: field.required ? [{ required: true }] : undefined,
    tag: field.key,
    valuePropName: field.type === 'boolean' ? 'checked' : undefined,
  };
}

// --------------- Build settings groups ---------------

function buildSettingsGroups(
  schema: FieldSchema[],
  t: (key: string) => string,
): FormGroupItemType[] {
  const settingsSchema = schema.find((f) => f.key === 'settings');
  if (!settingsSchema?.properties) return [];

  const items = settingsSchema.properties
    .filter((f) => !f.devOnly || process.env.NODE_ENV === 'development')
    .flatMap((f) => {
      if (f.type === 'object' && f.properties) {
        return f.properties.map((child) => fieldToFormItem(child, t, 'settings'));
      }
      return fieldToFormItem(f, t, 'settings');
    });

  return [
    {
      children: items,
      collapsible: true,
      defaultActive: false,
      key: 'settings',
      title: t(settingsSchema.label),
    },
  ];
}

function buildCredentialItems(schema: FieldSchema[], t: (key: string) => string): FormItemProps[] {
  const credentialsSchema = schema.find((f) => f.key === 'credentials');
  if (!credentialsSchema?.properties) return [];

  return credentialsSchema.properties
    .filter((f) => !f.devOnly || process.env.NODE_ENV === 'development')
    .map((f) => fieldToFormItem(f, t, 'credentials'));
}

// --------------- Body component ---------------

interface BodyProps {
  form: FormInstance<ChannelFormValues>;
  platformDef: SerializedPlatformDefinition;
}

const Body = memo<BodyProps>(({ platformDef, form }) => {
  const { t } = useTranslation('agent');
  const tStr = t as (key: string) => string;

  const credentialItems = useMemo(
    () => buildCredentialItems(platformDef.schema, tStr),
    [platformDef, tStr],
  );

  const settingsGroups = useMemo(
    () => buildSettingsGroups(platformDef.schema, tStr),
    [platformDef, tStr],
  );

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
      {credentialItems.map((item, i) => (
        <FormItem
          divider={i !== 0}
          key={item.tag || i}
          minWidth={'max(50%, 400px)'}
          variant="borderless"
          {...item}
        />
      ))}
      {settingsGroups.map((group) => (
        <FormGroup
          collapsible={group.collapsible}
          defaultActive={group.defaultActive}
          key={group.key}
          keyValue={group.key}
          style={{ marginBlockStart: 16 }}
          title={group.title}
          variant="borderless"
        >
          {Array.isArray(group.children) &&
            group.children.map((item, i) => (
              <FormItem
                divider={i !== 0}
                key={(item as FormItemProps).tag || i}
                minWidth={'max(50%, 400px)'}
                variant="borderless"
                {...(item as FormItemProps)}
              />
            ))}
        </FormGroup>
      ))}
    </Form>
  );
});

export default Body;

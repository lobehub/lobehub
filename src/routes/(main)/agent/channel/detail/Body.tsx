'use client';

import { Block, Flexbox, Form, FormGroup, FormItem, Icon, Tag, Text } from '@lobehub/ui';
import type { SelectOption } from '@lobehub/ui/base-ui';
import { Button, Select, Switch } from '@lobehub/ui/base-ui';
import { Form as AntdForm, type FormInstance, InputNumber, Popconfirm } from 'antd';
import { createStaticStyles } from 'antd-style';
import {
  Fingerprint,
  Hash,
  KeyRound,
  Link2,
  ListChecks,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  ToggleLeft,
  Trash2,
  UsersRound,
} from 'lucide-react';
import type { MouseEvent } from 'react';
import { Fragment, memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FormInput, FormPassword } from '@/components/FormInput';
import InfoTooltip from '@/components/InfoTooltip';
import type {
  FieldSchema,
  SerializedPlatformDefinition,
} from '@/server/services/bot/platforms/types';

import { platformCredentialBodyMap, platformCredentialExtrasMap } from '../platform/registry';
import { extractSettingsDefaults } from './formState';
import type { ChannelFormValues } from './index';

const prefixCls = 'ant';

const styles = createStaticStyles(({ css, cssVar }) => ({
  advancedGroup: css`
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 0 !important;

    .${prefixCls}-collapse-item {
      border-radius: 0 !important;
    }

    .${prefixCls}-collapse-header {
      align-items: center !important;

      margin-inline: -16px;
      padding-block: 10px !important;
      padding-inline: 16px !important;
      border-block-end: 0 !important;

      color: ${cssVar.colorTextSecondary} !important;

      transition: background-color ${cssVar.motionDurationFast} ${cssVar.motionEaseInOut};

      &:hover {
        background: ${cssVar.colorBgTextHover};
      }
    }

    .${prefixCls}-collapse-expand-icon {
      align-self: center;
      color: ${cssVar.colorTextSecondary} !important;
    }

    .${prefixCls}-collapse-title {
      display: flex;
      flex: 1 !important;
      align-items: center;
    }

    .${prefixCls}-collapse-content-box {
      padding-inline: 0 !important;
    }
  `,
  advancedTitle: css`
    font-size: 13px;
    font-weight: 400;
    line-height: 1.4;
    color: ${cssVar.colorTextSecondary};
  `,
  container: css`
    overflow: hidden;
    gap: 0;
    width: 100%;
    padding-inline: 16px;
  `,
  fieldIcon: css`
    flex: none;
    align-self: center;
    color: ${cssVar.colorTextSecondary};
  `,
  form: css`
    .${prefixCls}-form-item-label {
      display: flex;
      align-items: center;
    }

    .${prefixCls}-form-item-label > label {
      align-items: center;
      width: 100%;
    }

    .${prefixCls}-form-item-required::before {
      align-self: center !important;
    }

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
  disabled?: boolean;
  divider?: boolean;
  /** The field belongs to a gated feature the current plan doesn't include. */
  featureLocked?: boolean;
  field: FieldSchema;
  parentKey: string;
}

const renderFieldLabel = (field: FieldSchema, t: (key: string) => string) => {
  const hint = field.tooltip;

  if (!hint && !field.devOnly && !field.paidFeature) return t(field.label);

  return (
    <Flexbox horizontal align="center" gap={8}>
      {t(field.label)}
      {hint && <InfoTooltip size={'small'} title={t(hint)} />}
      {field.paidFeature && (
        <Tag color="gold" size={'small'}>
          {t('channel.paidFeature.badge')}
        </Tag>
      )}
      {field.devOnly && <Tag color="gold">Dev Only</Tag>}
    </Flexbox>
  );
};

const getFieldIcon = (field: FieldSchema) => {
  const key = field.key.toLowerCase();

  if (/key|password|secret|token/.test(key)) return KeyRound;
  if (key.includes('url')) return Link2;
  if (key.endsWith('id') || key.includes('identifier')) return Fingerprint;
  if (field.type === 'array') return UsersRound;
  if (field.type === 'boolean') return ToggleLeft;
  if (field.enum) return ListChecks;
  if (field.type === 'number' || field.type === 'integer') return Hash;

  return SlidersHorizontal;
};

const renderFieldIcon = (field: FieldSchema) => (
  <Icon className={styles.fieldIcon} icon={getFieldIcon(field)} size={20} />
);

const SchemaField = memo<SchemaFieldProps>(
  ({ field, parentKey, divider, disabled: formDisabled, featureLocked }) => {
    const { t: _t } = useTranslation('agent');
    const t = _t as (key: string) => string;

    // Scalar controls fully lock with the feature; list fields handle the
    // locked state themselves so operators can still remove stale rows.
    const disabled = formDisabled || featureLocked;

    // Conditional visibility: watch the sibling field specified by visibleWhen
    const watchedValue = AntdForm.useWatch(
      field.visibleWhen ? [parentKey, field.visibleWhen.field] : [],
    );
    if (field.visibleWhen && watchedValue !== field.visibleWhen.value) return null;

    // Only explicitly authored, actionable guidance earns a help affordance.
    // Generic schema descriptions stay out of the compact row layout.
    const label = renderFieldLabel(field, t);

    // Array of objects (e.g. user / channel allowlist) — needs Form.List, can't
    // be expressed as a single control inside a name-bound FormItem.
    if (field.type === 'array' && field.items?.type === 'object') {
      return (
        <ObjectListField
          disabled={formDisabled}
          divider={divider}
          featureLocked={featureLocked}
          field={field}
          icon={renderFieldIcon(field)}
          label={label}
          parentKey={parentKey}
        />
      );
    }

    let children: React.ReactNode;
    switch (field.type) {
      case 'password': {
        children = (
          <FormPassword
            autoComplete="new-password"
            disabled={disabled}
            placeholder={field.placeholder ? t(field.placeholder) : undefined}
          />
        );
        break;
      }
      case 'boolean': {
        children = <Switch disabled={disabled} />;
        break;
      }
      case 'number':
      case 'integer': {
        children = (
          <InputNumber
            disabled={disabled}
            max={field.maximum}
            min={field.minimum}
            placeholder={field.placeholder ? t(field.placeholder) : undefined}
            style={{ width: '100%' }}
          />
        );
        break;
      }
      case 'string': {
        if (field.enum) {
          const hasDescriptions = field.enumDescriptions?.some(Boolean);
          const options = field.enum.map((value, i) => ({
            description: field.enumDescriptions?.[i] ? t(field.enumDescriptions[i]) : undefined,
            label: field.enumLabels?.[i] ? t(field.enumLabels[i]) : value,
            value,
          })) satisfies Array<SelectOption<string> & { description?: string }>;

          children = (
            <Select
              disabled={disabled}
              options={options}
              placeholder={field.placeholder ? t(field.placeholder) : undefined}
              optionRender={
                hasDescriptions
                  ? (item) => {
                      const option = item as SelectOption<string> & { description?: string };

                      return (
                        <Flexbox horizontal align="center" gap={12} justify="space-between">
                          <span>{option.label}</span>
                          {option.description && (
                            <Text fontSize={12} type="secondary">
                              {option.description}
                            </Text>
                          )}
                        </Flexbox>
                      );
                    }
                  : undefined
              }
            />
          );
        } else {
          children = (
            <FormInput
              disabled={disabled}
              placeholder={field.placeholder ? t(field.placeholder) : t(field.label)}
            />
          );
        }
        break;
      }
      default: {
        children = (
          <FormInput
            disabled={disabled}
            placeholder={field.placeholder ? t(field.placeholder) : t(field.label)}
          />
        );
      }
    }

    return (
      <FormItem
        avatar={renderFieldIcon(field)}
        divider={divider}
        initialValue={field.default}
        label={label}
        minWidth={'max(50%, 400px)'}
        name={[parentKey, field.key]}
        rules={buildRules(field, t)}
        valuePropName={field.type === 'boolean' ? 'checked' : undefined}
        variant="outlined"
      >
        {children}
      </FormItem>
    );
  },
);

// --------------- Object-list field (e.g. allowFrom: [{id, name?}]) ---------------

interface ObjectListFieldProps {
  disabled?: boolean;
  divider?: boolean;
  /** The field belongs to a gated feature the current plan doesn't include. */
  featureLocked?: boolean;
  field: FieldSchema;
  icon: React.ReactNode;
  label: React.ReactNode;
  parentKey: string;
}

const ObjectListField = memo<ObjectListFieldProps>(
  ({ field, parentKey, divider, icon, label, disabled, featureLocked }) => {
    const { t: _t } = useTranslation('agent');
    const t = _t as (key: string) => string;

    // A locked feature blocks new rows and edits, but existing rows must stay
    // removable — the server-side write gate always allows clearing keywords,
    // and stale rows would otherwise keep the feature semi-active with no way
    // out short of resetting all advanced settings.
    const editDisabled = disabled || featureLocked;

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
        avatar={icon}
        divider={divider}
        label={label}
        minWidth={'max(50%, 400px)'}
        variant="outlined"
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
                          disabled={editDisabled}
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
                    disabled={disabled}
                    icon={<Trash2 size={14} />}
                    type="text"
                    onClick={() => remove(name)}
                  />
                </Flexbox>
              ))}
              {featureLocked && (
                <Flexbox style={{ fontSize: 12, opacity: 0.6, paddingBlock: 4 }}>
                  {t('channel.paidFeature.fieldLocked')}
                </Flexbox>
              )}
              <Button
                block
                disabled={editDisabled}
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
  },
);

// --------------- ApplicationId field (standalone, not nested) ---------------

const ApplicationIdField = memo<{ disabled?: boolean; divider?: boolean; field: FieldSchema }>(
  ({ field, divider, disabled }) => {
    const { t: _t } = useTranslation('agent');
    const t = _t as (key: string) => string;

    return (
      <FormItem
        avatar={renderFieldIcon(field)}
        divider={divider}
        initialValue={field.default}
        label={renderFieldLabel(field, t)}
        minWidth={'max(50%, 400px)'}
        name="applicationId"
        rules={field.required ? [{ message: t(field.label), required: true }] : undefined}
        variant="outlined"
      >
        <FormInput
          disabled={disabled}
          placeholder={field.placeholder ? t(field.placeholder) : t(field.label)}
        />
      </FormItem>
    );
  },
);

// --------------- Helper: flatten fields from schema ---------------

function getFields(schema: FieldSchema[], sectionKey: string): FieldSchema[] {
  const section = schema.find((f) => f.key === sectionKey);
  if (!section?.properties) return [];

  return section.properties
    .filter((f) => !f.devOnly || __DEV__)
    .flatMap((f) => {
      if (f.type === 'object' && f.properties) {
        return f.properties.filter((child) => !child.devOnly || __DEV__);
      }
      return f;
    });
}

// --------------- Settings group title (memo'd) ---------------

const SettingsTitle = memo<{ schema: FieldSchema[] }>(({ schema }) => {
  const { t: _t } = useTranslation('agent');
  const t = _t as (key: string) => string;
  const settingsSchema = schema.find((f) => f.key === 'settings');
  return settingsSchema ? (
    <Text as={'span'} className={styles.advancedTitle}>
      {t(settingsSchema.label)}
    </Text>
  ) : null;
});

// --------------- Body component ---------------

interface BodyProps {
  currentConfig?: {
    applicationId: string;
    credentials: Record<string, string>;
    settings?: Record<string, unknown> | null;
  };
  disabled?: boolean;
  form: FormInstance<ChannelFormValues>;
  hasConfig?: boolean;
  onAuthenticated?: (params: {
    applicationId: string;
    credentials: Record<string, string>;
  }) => void;
  onValuesChange?: (values: ChannelFormValues) => void;
  platformDef: SerializedPlatformDefinition;
}

const Body = memo<BodyProps>(
  ({ platformDef, form, hasConfig, currentConfig, onAuthenticated, onValuesChange, disabled }) => {
    const { t: _t } = useTranslation('agent');
    const t = _t as (key: string) => string;

    const CustomCredentialBody = platformCredentialBodyMap[platformDef.id];
    const CredentialExtras = platformCredentialExtrasMap[platformDef.id];

    const credentialFields = useMemo(
      () => getFields(platformDef.schema, 'credentials'),
      [platformDef.schema],
    );

    const settingsFields = useMemo(
      () => getFields(platformDef.schema, 'settings'),
      [platformDef.schema],
    );

    // Auto-expand the settings group on mount when an already-saved bot is
    // missing its operator User ID, so operators land directly on the field
    // the Footer alert is asking them to fill in. Driven off the saved value
    // (not the form watch) because `defaultActive` is mount-only — the form
    // hasn't hydrated yet at this point — and skipped on platforms without
    // a `userId` field in their schema (e.g. WeChat).
    const userIdInitiallyMissing = useMemo(() => {
      if (!hasConfig) return false;
      const hasUserIdField = settingsFields.some((f) => f.key === 'userId');
      if (!hasUserIdField) return false;
      const savedUserId = currentConfig?.settings?.userId;
      return !(typeof savedUserId === 'string' && savedUserId.trim());
    }, [hasConfig, settingsFields, currentConfig?.settings]);
    const [settingsActive, setSettingsActive] = useState(userIdInitiallyMissing);

    const handleResetSettings = useCallback(() => {
      form.setFieldsValue({
        settings: extractSettingsDefaults(platformDef.schema) as Record<string, {} | undefined>,
      });
      onValuesChange?.(form.getFieldsValue(true) as ChannelFormValues);
    }, [form, onValuesChange, platformDef.schema]);

    const handleSettingsHeaderClick = useCallback((event: MouseEvent<HTMLDivElement>) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (!target.closest(`.${prefixCls}-collapse-header`)) return;
      if (target.closest(`.${prefixCls}-collapse-extra`)) return;

      event.preventDefault();
      event.stopPropagation();
      setSettingsActive((active) => !active);
    }, []);

    return (
      <Form
        className={styles.form}
        form={form}
        gap={0}
        itemMinWidth={'max(50%, 400px)'}
        requiredMark={false}
        style={{ maxWidth: 1024, padding: '16px 0', width: '100%' }}
        variant={'borderless'}
        onValuesChange={(_, values) => onValuesChange?.(values as ChannelFormValues)}
      >
        <Block className={styles.container} variant={'outlined'}>
          {CustomCredentialBody ? (
            <CustomCredentialBody
              currentConfig={currentConfig}
              disabled={disabled}
              hasConfig={hasConfig}
              onAuthenticated={onAuthenticated}
            />
          ) : (
            <>
              {/* Render top-level sections in schema order so each platform controls
              its own field ordering. LINE places `credentials` before `applicationId`
              because the operator must enter the channel access token before the
              "Fetch from LINE" button (rendered after applicationId) can auto-fill
              the destination user ID; Discord/Slack/QQ/Feishu place `applicationId`
              first as a primary identifier. */}
              {platformDef.schema
                .filter(
                  (section) => section.key === 'applicationId' || section.key === 'credentials',
                )
                .map((section, sectionIndex) => {
                  const needsDivider = sectionIndex > 0;
                  if (section.key === 'applicationId') {
                    return (
                      <ApplicationIdField
                        disabled={disabled}
                        divider={needsDivider}
                        field={section}
                        key="applicationId"
                      />
                    );
                  }
                  return (
                    <Fragment key="credentials">
                      {credentialFields.map((field, i) => (
                        <SchemaField
                          disabled={disabled}
                          divider={needsDivider || i !== 0}
                          field={field}
                          key={field.key}
                          parentKey="credentials"
                        />
                      ))}
                    </Fragment>
                  );
                })}
              {/* Platform-specific helpers (e.g. LINE's "Fetch from LINE" button)
              render after the credential + applicationId block so the button
              sits next to the field it acts on. */}
              {CredentialExtras && <CredentialExtras disabled={disabled} />}
            </>
          )}
          {settingsFields.length > 0 && (
            <div onClickCapture={handleSettingsHeaderClick}>
              <FormGroup
                collapsible
                active={settingsActive}
                className={styles.advancedGroup}
                defaultActive={userIdInitiallyMissing}
                keyValue={`settings-${platformDef.id}`}
                title={<SettingsTitle schema={platformDef.schema} />}
                variant="borderless"
                extra={
                  settingsActive ? (
                    <Popconfirm
                      title={t('channel.settingsResetConfirm')}
                      onConfirm={disabled ? undefined : handleResetSettings}
                    >
                      <Button
                        disabled={disabled}
                        icon={<RotateCcw size={14} />}
                        size="small"
                        type="default"
                      >
                        {t('channel.settingsResetDefault')}
                      </Button>
                    </Popconfirm>
                  ) : undefined
                }
                onCollapse={setSettingsActive}
              >
                {settingsFields.map((field) => {
                  // Feature-gated fields (e.g. watch keywords) lock when the
                  // resolved access meta reports the feature as not allowed.
                  const featureLocked =
                    !!field.paidFeature &&
                    platformDef.access?.features?.[field.paidFeature]?.allowed === false;
                  return (
                    <SchemaField
                      divider
                      disabled={disabled}
                      featureLocked={featureLocked}
                      field={field}
                      key={field.key}
                      parentKey="settings"
                    />
                  );
                })}
              </FormGroup>
            </div>
          )}
        </Block>
      </Form>
    );
  },
);

export default Body;

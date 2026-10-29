'use client';

import { isMaskedBotCredential } from '@lobechat/const';
import type { CheckboxProps, SelectOption } from '@lobehub/ui';
import {
  ActionIcon,
  Button,
  Checkbox,
  Flexbox,
  InputNumber,
  Select,
  Switch,
  Tag,
  Text,
} from '@lobehub/ui';
import { Form, useFormInstance, useWatch } from '@lobehub/ui/form';
import { Plus, Trash2 } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { FormInput, FormPassword, FormTextArea } from '@/components/FormInput';
import InfoTooltip from '@/components/InfoTooltip';
import type { FieldSchema } from '@/server/services/bot/platforms/types';

import { ChoiceList, type ChoiceOption } from './ChoiceList';

// --------------- Validation rules builder ---------------

const isEmptyValue = (value: unknown) =>
  value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length);

export function buildValidate(field: FieldSchema, t: (key: string) => string) {
  const pattern = field.pattern ? new RegExp(field.pattern) : undefined;
  const isNumber = field.type === 'number' || field.type === 'integer';
  const { maximum, minimum } = field;

  if (
    !field.required &&
    !pattern &&
    !(isNumber && (typeof minimum === 'number' || typeof maximum === 'number'))
  )
    return undefined;

  return (value: unknown) => {
    if (isEmptyValue(value)) return field.required ? t(field.label) : undefined;

    // Format constraint declared by the platform schema. Empty stays valid, so an
    // untouched optional field does not trip it, and so does the placeholder the
    // server returns in place of a stored secret — the save path swaps that back
    // for the real value, and holding it to the platform's format here would make
    // every unrelated edit demand the secret be retyped.
    if (
      pattern &&
      typeof value === 'string' &&
      !isMaskedBotCredential(value) &&
      !pattern.test(value)
    )
      return field.patternMessage ? t(field.patternMessage) : t(field.label);

    if (isNumber && typeof value === 'number') {
      if (typeof minimum === 'number' && value < minimum) return `${t(field.label)} ≥ ${minimum}`;
      if (typeof maximum === 'number' && value > maximum) return `${t(field.label)} ≤ ${maximum}`;
    }

    return undefined;
  };
}

// --------------- Shared pieces ---------------

export const renderFieldLabel = (field: FieldSchema, t: (key: string) => string) => {
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

// A row is a label + one line of help on the left and a short control on the
// right. Long free-text values (credentials, IDs lists) take the whole row.
const CONTROL_WIDTH = 'min(240px, 100%)';

// --------------- Single field component (memo'd) ---------------

interface SchemaFieldProps {
  /** Replaces the schema's description line, e.g. with a warning that depends on other values. */
  descOverride?: React.ReactNode;
  disabled?: boolean;
  divider?: boolean;
  /** Replaces the "nothing added yet" line of a list field. */
  emptyOverride?: string;
  /** The field belongs to a gated feature the current plan doesn't include. */
  featureLocked?: boolean;
  field: FieldSchema;
  /** Stack the label over a full-width control, for long values like secrets. */
  fullWidth?: boolean;
  /** Keep the field mounted (so its value is kept and saved) but not shown. */
  hidden?: boolean;
  labelOverride?: React.ReactNode;
  parentKey: string;
  /** Replaces the schema-derived validation rule. */
  validateOverride?: (value: unknown) => string | undefined;
}

export const SchemaField = memo<SchemaFieldProps>(
  ({
    field,
    parentKey,
    divider,
    disabled: formDisabled,
    featureLocked,
    fullWidth,
    hidden,
    descOverride,
    emptyOverride,
    labelOverride,
    validateOverride,
  }) => {
    const { t: _t } = useTranslation('agent');
    const t = _t as (key: string) => string;

    // Scalar controls fully lock with the feature; list fields handle the
    // locked state themselves so operators can still remove stale rows.
    const disabled = formDisabled || featureLocked;

    // Conditional visibility: watch the sibling field specified by visibleWhen
    const form = useFormInstance();
    const conditions = field.visibleWhen
      ? Array.isArray(field.visibleWhen)
        ? field.visibleWhen
        : [field.visibleWhen]
      : [];
    // Joined into one string so the selector returns a stable value between renders.
    const watchedValues = useWatch(form, (values) =>
      JSON.stringify(conditions.map((c) => values[parentKey]?.[c.field] ?? null)),
    );
    const selectedValue = useWatch(form, (values) =>
      field.enum ? values[parentKey]?.[field.key] : undefined,
    );
    if (conditions.length > 0) {
      const watched = JSON.parse(watchedValues) as unknown[];
      // Every condition must hold. Within one, an array matches any of its
      // entries, so one field can be shared by several sibling values (e.g. the
      // window size for `burst` + `debounce`).
      const matches = conditions.every(({ value: expected }, i) => {
        const actual = watched[i] ?? undefined;
        return Array.isArray(expected) ? expected.includes(actual) : actual === expected;
      });
      if (!matches) return null;
    }

    const label = labelOverride ?? renderFieldLabel(field, t);

    // The help line follows the choice: once someone picks a policy, what that
    // policy does is worth more than the generic description of the field.
    const selectedIndex = field.enum ? field.enum.indexOf(selectedValue as string) : -1;
    // A choice list shows every option's sentence already; its help line stays the field's own.
    const selectedHint = field.choices ? undefined : field.enumDescriptions?.[selectedIndex];
    const descKey = selectedHint || field.description;
    const desc = descOverride ?? (descKey ? t(descKey) : undefined);

    // Array of objects (e.g. user / channel allowlist) — needs Form.List, can't
    // be expressed as a single control inside a name-bound Form.Field.
    if (field.type === 'array' && field.items?.type === 'object') {
      return (
        <div hidden={hidden}>
          <ObjectListField
            desc={desc}
            disabled={formDisabled}
            divider={divider}
            emptyOverride={emptyOverride}
            featureLocked={featureLocked}
            field={field}
            label={label}
            parentKey={parentKey}
          />
        </div>
      );
    }

    const placeholder = field.placeholder ? t(field.placeholder) : t(field.label);
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
            style={{ width: 160 }}
          />
        );
        break;
      }
      case 'string': {
        if (field.enum && field.choices) {
          children = (
            <FormChoiceList
              aria-label={t(field.label)}
              disabled={disabled}
              options={field.enum.map((value, i) => ({
                desc: field.enumDescriptions?.[i] ? t(field.enumDescriptions[i]) : undefined,
                label: field.enumLabels?.[i] ? t(field.enumLabels[i]) : value,
                recommendedLabel:
                  field.enumRecommended === value ? t('channel.access.recommended') : undefined,
                value,
              }))}
            />
          );
        } else if (field.enum) {
          const options = field.enum.map((value, i) => ({
            description: field.enumDescriptions?.[i] ? t(field.enumDescriptions[i]) : undefined,
            label: field.enumLabels?.[i] ? t(field.enumLabels[i]) : value,
            value,
          })) satisfies Array<SelectOption<string> & { description?: string }>;
          const hasDescriptions = options.some((option) => option.description);

          children = (
            <Select
              disabled={disabled}
              options={options}
              placeholder={field.placeholder ? t(field.placeholder) : undefined}
              style={{ width: CONTROL_WIDTH }}
              optionRender={
                hasDescriptions
                  ? (item) => {
                      const option = item as SelectOption<string> & { description?: string };

                      return (
                        <Flexbox gap={2}>
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
        } else if (field.rows) {
          // A prompt or other longer text: a text area across the whole row, with a counter
          // against the limit the runtime enforces.
          children = (
            <FormTextArea
              disabled={disabled}
              maxLength={field.maximum}
              placeholder={placeholder}
              rows={field.rows}
              showCount={typeof field.maximum === 'number'}
              style={{ resize: 'vertical', width: '100%' }}
            />
          );
        } else {
          children = (
            <FormInput
              disabled={disabled}
              placeholder={placeholder}
              style={fullWidth ? undefined : { width: CONTROL_WIDTH }}
            />
          );
        }
        break;
      }
      default: {
        children = (
          <FormInput
            disabled={disabled}
            placeholder={placeholder}
            style={fullWidth ? undefined : { width: CONTROL_WIDTH }}
          />
        );
      }
    }

    return (
      <div hidden={hidden}>
        <Form.Field
          desc={desc}
          divider={divider}
          label={label}
          name={`${parentKey}.${field.key}`}
          validate={validateOverride ?? buildValidate(field, t)}
          layout={
            fullWidth || field.type === 'password' || field.rows || field.choices
              ? 'vertical'
              : 'horizontal'
          }
        >
          {children}
        </Form.Field>
      </div>
    );
  },
);

SchemaField.displayName = 'ChannelSchemaField';

/** {@link ChoiceList} bound to a form field: the field hands it the value and takes the change. */
const FormChoiceList = ({
  onChange,
  value,
  ...props
}: {
  'aria-label'?: string;
  'disabled'?: boolean;
  'onChange'?: (value: string) => void;
  'options': ChoiceOption<string>[];
  'value'?: string;
}) => <ChoiceList {...props} value={value ?? ''} onChange={(next) => onChange?.(next)} />;

/**
 * {@link Checkbox} bound to a form field. A row saved before the property existed has no value;
 * it reads as unchecked instead of leaving the checkbox uncontrolled.
 */
const FormCheckbox = ({
  onChange,
  value,
  ...props
}: Omit<CheckboxProps, 'checked' | 'onChange'> & {
  onChange?: (checked: boolean) => void;
  value?: boolean;
}) => <Checkbox {...props} checked={value === true} onChange={(next) => onChange?.(next)} />;

// --------------- Object-list field (e.g. allowFrom: [{id, name?}]) ---------------

interface ObjectListFieldProps {
  desc?: React.ReactNode;
  disabled?: boolean;
  divider?: boolean;
  emptyOverride?: string;
  /** The field belongs to a gated feature the current plan doesn't include. */
  featureLocked?: boolean;
  field: FieldSchema;
  label: React.ReactNode;
  parentKey: string;
}

const ObjectListField = memo<ObjectListFieldProps>(
  ({ desc, emptyOverride, field, parentKey, divider, label, disabled, featureLocked }) => {
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
    const emptyLabel = emptyOverride ?? t(`${field.label}Empty` as 'channel.allowFromEmpty');
    const removeLabel = t('channel.allowListRemove');

    // `maximum` mirrors the runtime parser's own cap. An over-cap list is dropped wholesale there
    // (for an allowlist that means "restrict nothing"), so the editor stops growing at the cap and
    // flags a list that already arrived over it. The save path refuses such a value; see
    // `findOverLimitSettings`.
    const limit = typeof field.maximum === 'number' ? field.maximum : undefined;
    const limitMessage = limit
      ? (t('channel.channelListLimit') as string).replace('{{max}}', String(limit))
      : undefined;

    return (
      <Form.Field desc={desc} divider={divider} label={label} layout="vertical">
        <Form.List name={`${parentKey}.${field.key}`}>
          {({ fields: rows, add, remove }) => (
            <Flexbox gap={8} style={{ width: '100%' }}>
              {limit !== undefined && rows.length > limit && (
                <Text fontSize={12} type="danger">
                  {limitMessage}
                </Text>
              )}
              {rows.length === 0 && (
                <Text fontSize={12} type="secondary">
                  {emptyLabel}
                </Text>
              )}
              {rows.map(({ index, key, name }) => (
                <Flexbox horizontal align="center" gap={8} key={key}>
                  {itemProps.map((sub, subIndex) =>
                    // A per-row switch (e.g. "this keyword is one of the bot's names") sits after
                    // the text inputs at its natural width, its explanation in the tooltip.
                    sub.type === 'boolean' ? (
                      <Flexbox horizontal align="center" flex="none" gap={4} key={sub.key}>
                        <Form.Field bare name={`${name}.${sub.key}`}>
                          <FormCheckbox disabled={editDisabled}>
                            {t(sub.label as 'channel.watchKeywordAsNameLabel')}
                          </FormCheckbox>
                        </Form.Field>
                        {sub.description && (
                          <InfoTooltip
                            size={'small'}
                            title={t(sub.description as 'channel.watchKeywordAsNameHint')}
                          />
                        )}
                      </Flexbox>
                    ) : (
                      <div key={sub.key} style={{ flex: subIndex === 0 ? 1 : 2, minWidth: 0 }}>
                        <Form.Field
                          bare
                          name={`${name}.${sub.key}`}
                          validate={
                            sub.required
                              ? (value?: string) => (value?.trim() ? undefined : t(sub.label))
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
                        </Form.Field>
                      </div>
                    ),
                  )}
                  <ActionIcon
                    aria-label={removeLabel}
                    disabled={disabled}
                    icon={Trash2}
                    title={removeLabel}
                    onClick={() => remove(index)}
                  />
                </Flexbox>
              ))}
              {featureLocked && (
                <Text fontSize={12} type="secondary">
                  {t('channel.paidFeature.fieldLocked')}
                </Text>
              )}
              <Button
                disabled={editDisabled || (limit !== undefined && rows.length >= limit)}
                icon={<Plus size={14} />}
                size="small"
                style={{ alignSelf: 'flex-start' }}
                type="text"
                onClick={() => add({ id: '', name: '' })}
              >
                {addLabel}
              </Button>
            </Flexbox>
          )}
        </Form.List>
      </Form.Field>
    );
  },
);

ObjectListField.displayName = 'ChannelObjectListField';

// --------------- ApplicationId field (standalone, not nested) ---------------

export const ApplicationIdField = memo<{
  disabled?: boolean;
  divider?: boolean;
  field: FieldSchema;
}>(({ field, divider, disabled }) => {
  const { t: _t } = useTranslation('agent');
  const t = _t as (key: string) => string;

  return (
    <Form.Field
      desc={field.description ? t(field.description) : undefined}
      divider={divider}
      label={renderFieldLabel(field, t)}
      layout="vertical"
      name="applicationId"
      validate={buildValidate(field, t)}
    >
      <FormInput
        disabled={disabled}
        placeholder={field.placeholder ? t(field.placeholder) : t(field.label)}
      />
    </Form.Field>
  );
});

ApplicationIdField.displayName = 'ChannelApplicationIdField';

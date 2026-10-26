'use client';

import { isMaskedBotCredential } from '@lobechat/const';
import type { SelectOption } from '@lobehub/ui';
import { Button, Flexbox, InputNumber, Select, Switch, Tag, Text } from '@lobehub/ui';
import { Form, useFormInstance, useWatch } from '@lobehub/ui/form';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Plus, Trash2 } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { FormInput, FormPassword } from '@/components/FormInput';
import InfoTooltip from '@/components/InfoTooltip';
import type { FieldSchema } from '@/server/services/bot/platforms/types';

import { isFieldReleased } from './formState';

/**
 * Text inputs take the Settings pages' width (`FORM_STYLE.itemMinWidth`); selects, numbers and
 * switches size to their content.
 */
export const CHANNEL_INPUT_MIN_WIDTH = 'max(34%, 240px)';

const styles = stylex.create({
  hint: {
    color: cssVar.colorTextTertiary,
    fontSize: 12,
    paddingBlock: 4,
  },
  limitHint: {
    color: cssVar.colorError,
    fontSize: 12,
    paddingBlock: 4,
  },
});

type Translate = (key: string) => string;

// --------------- Validation rules builder ---------------

const isEmptyValue = (value: unknown) =>
  value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length);

export function buildValidate(field: FieldSchema, t: Translate) {
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

// --------------- Label and description ---------------

const renderFieldLabel = (field: FieldSchema, t: Translate) => {
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

/** What the value does, in one line under the label — the schema's own description. */
const renderFieldDesc = (field: FieldSchema, t: Translate) =>
  field.description ? t(field.description) : undefined;

// --------------- Single field component (memo'd) ---------------

interface SchemaFieldProps {
  disabled?: boolean;
  divider?: boolean;
  /** The field belongs to a gated feature the current plan doesn't include. */
  featureLocked?: boolean;
  field: FieldSchema;
  parentKey: string;
}

export const SchemaField = memo<SchemaFieldProps>(
  ({ field, parentKey, divider, disabled: formDisabled, featureLocked }) => {
    const { t: _t } = useTranslation('agent');
    const t = _t as Translate;

    // Scalar controls fully lock with the feature; list fields handle the
    // locked state themselves so operators can still remove stale rows.
    const disabled = formDisabled || featureLocked;

    // Conditional visibility: watch the sibling field specified by visibleWhen
    const form = useFormInstance();
    const watchedValue = useWatch(form, (values) =>
      field.visibleWhen ? values[parentKey]?.[field.visibleWhen.field] : undefined,
    );
    if (field.visibleWhen) {
      // An array matches any of its entries, so one field can be shared by
      // several sibling values (e.g. the window size for `burst` + `debounce`).
      const expected = field.visibleWhen.value;
      const matches = Array.isArray(expected)
        ? expected.includes(watchedValue)
        : watchedValue === expected;
      if (!matches) return null;
    }

    const label = renderFieldLabel(field, t);
    const desc = renderFieldDesc(field, t);

    // Array of objects (e.g. user / channel allowlist) — needs Form.List, can't
    // be expressed as a single control inside a name-bound Form.Field.
    if (field.type === 'array' && field.items?.type === 'object') {
      return (
        <ObjectListField
          desc={desc}
          disabled={formDisabled}
          divider={divider}
          featureLocked={featureLocked}
          field={field}
          label={label}
          parentKey={parentKey}
        />
      );
    }

    const placeholder = field.placeholder ? t(field.placeholder) : undefined;
    let children: React.ReactNode;
    let minWidth: string | undefined = CHANNEL_INPUT_MIN_WIDTH;

    switch (field.type) {
      case 'password': {
        children = (
          <FormPassword autoComplete="new-password" disabled={disabled} placeholder={placeholder} />
        );
        break;
      }
      case 'boolean': {
        children = <Switch disabled={disabled} />;
        minWidth = undefined;
        break;
      }
      case 'number':
      case 'integer': {
        children = (
          <InputNumber
            disabled={disabled}
            max={field.maximum}
            min={field.minimum}
            placeholder={placeholder}
            style={{ width: 160 }}
          />
        );
        minWidth = undefined;
        break;
      }
      default: {
        if (field.type === 'string' && field.enum) {
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
              placeholder={placeholder}
              popupMatchSelectWidth={false}
              style={{ minWidth: 200 }}
              optionRender={
                hasDescriptions
                  ? (item) => {
                      const option = item as SelectOption<string> & { description?: string };

                      return (
                        <Flexbox gap={2} style={{ maxWidth: 360, paddingBlock: 2 }}>
                          <span>{option.label}</span>
                          {option.description && (
                            <Text fontSize={12} style={{ whiteSpace: 'normal' }} type="secondary">
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
          minWidth = undefined;
        } else {
          children = <FormInput disabled={disabled} placeholder={placeholder ?? t(field.label)} />;
        }
      }
    }

    return (
      <Form.Field
        desc={desc}
        divider={divider}
        label={label}
        minWidth={minWidth}
        name={`${parentKey}.${field.key}`}
        validate={buildValidate(field, t)}
        variant="outlined"
      >
        {children}
      </Form.Field>
    );
  },
);

SchemaField.displayName = 'ChannelSchemaField';

// --------------- Object-list field (e.g. allowFrom: [{id, name?}]) ---------------

interface ObjectListFieldProps {
  desc?: React.ReactNode;
  disabled?: boolean;
  divider?: boolean;
  /** The field belongs to a gated feature the current plan doesn't include. */
  featureLocked?: boolean;
  field: FieldSchema;
  label: React.ReactNode;
  parentKey: string;
}

const ObjectListField = memo<ObjectListFieldProps>(
  ({ field, parentKey, divider, desc, label, disabled, featureLocked }) => {
    const { t: _t } = useTranslation('agent');
    const t = _t as Translate;

    // A locked feature blocks new rows and edits, but existing rows must stay
    // removable — the server-side write gate always allows clearing keywords,
    // and stale rows would otherwise keep the feature semi-active with no way
    // out short of resetting all settings.
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

    // `maximum` mirrors the runtime parser's own cap. An over-cap list is dropped wholesale there
    // — for an allowlist that means "restrict nothing" — so the editor stops growing at the cap
    // and flags a list that already arrived over it (hand-written config, or a save from before
    // the cap existed). The save path refuses such a value; see `findOverLimitSettings`.
    const limit = typeof field.maximum === 'number' ? field.maximum : undefined;
    const limitMessage = limit
      ? t('channel.channelListLimit').replace('{{max}}', String(limit))
      : undefined;

    return (
      <Form.Field
        desc={desc}
        divider={divider}
        label={label}
        layout={'vertical'}
        variant="outlined"
      >
        <Form.List name={`${parentKey}.${field.key}`}>
          {({ fields: rows, add, remove }) => (
            <Flexbox gap={8} style={{ width: '100%' }}>
              {limit !== undefined && rows.length > limit && (
                <div {...stylex.props(styles.limitHint)}>{limitMessage}</div>
              )}
              {rows.length === 0 && <div {...stylex.props(styles.hint)}>{emptyLabel}</div>}
              {rows.map(({ index, key, name }) => (
                <Flexbox horizontal align="center" gap={8} key={key}>
                  {itemProps.map((sub) => (
                    <div key={sub.key} style={{ flex: 1, minWidth: 0 }}>
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
                  ))}
                  <Button
                    aria-label={removeLabel}
                    disabled={disabled}
                    icon={<Trash2 size={14} />}
                    type="text"
                    onClick={() => remove(index)}
                  />
                </Flexbox>
              ))}
              {featureLocked && (
                <div {...stylex.props(styles.hint)}>{t('channel.paidFeature.fieldLocked')}</div>
              )}
              <Button
                disabled={editDisabled || (limit !== undefined && rows.length >= limit)}
                icon={<Plus size={14} />}
                style={{ alignSelf: 'flex-start' }}
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
  const t = _t as Translate;

  return (
    <Form.Field
      desc={renderFieldDesc(field, t)}
      divider={divider}
      label={renderFieldLabel(field, t)}
      minWidth={CHANNEL_INPUT_MIN_WIDTH}
      name="applicationId"
      validate={buildValidate(field, t)}
      variant="outlined"
    >
      <FormInput
        disabled={disabled}
        placeholder={field.placeholder ? t(field.placeholder) : t(field.label)}
      />
    </Form.Field>
  );
});

ApplicationIdField.displayName = 'ChannelApplicationIdField';

// --------------- Helper: flatten fields from schema ---------------

export function getFields(
  schema: FieldSchema[],
  sectionKey: string,
  featureFlags?: Record<string, unknown>,
): FieldSchema[] {
  const section = schema.find((f) => f.key === sectionKey);
  if (!section?.properties) return [];

  const shown = (f: FieldSchema) => (!f.devOnly || __DEV__) && isFieldReleased(f, featureFlags);

  return section.properties.filter(shown).flatMap((f) => {
    if (f.type === 'object' && f.properties) {
      return f.properties.filter(shown);
    }
    return f;
  });
}

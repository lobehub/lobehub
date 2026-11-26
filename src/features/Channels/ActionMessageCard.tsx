import { Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { CircleCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { ActionField } from './actionMessage';

const local = stylex.create({
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    maxWidth: 480,
    padding: 12,
    borderColor: cssVar.colorBorderSecondary,
    borderStyle: 'solid',
    borderWidth: 1,
    borderRadius: cssVar.borderRadiusLG,
    background: cssVar.colorBgContainerSecondary,
  },
  head: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    minWidth: 0,
    color: cssVar.colorText,
    fontWeight: 500,
  },
  fields: {
    display: 'grid',
    gridTemplateColumns: 'fit-content(180px) 1fr',
    columnGap: 12,
    rowGap: 4,
    margin: 0,
    fontSize: 13,
  },
  label: {
    color: cssVar.colorTextSecondary,
  },
  value: {
    minWidth: 0,
    margin: 0,
    color: cssVar.colorText,
    overflowWrap: 'anywhere',
    whiteSpace: 'pre-wrap',
  },
  empty: {
    color: cssVar.colorTextQuaternary,
  },
});

/**
 * A reply sent from a card's button, shown as what was submitted: the card's title and each value
 * under its field's label, in place of the tagged payload the Agent reads.
 */
export function ActionMessageCard({ fields, title }: { fields: ActionField[]; title?: string }) {
  const { t } = useTranslation('channel');
  const show = (value: unknown) => {
    if (value === null || value === undefined || value === '') return;
    if (typeof value === 'boolean') return t(value ? 'a2uiAction.yes' : 'a2uiAction.no');
    if (Array.isArray(value)) return value.length ? value.map(String).join(', ') : undefined;
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
  };
  return (
    <div {...stylex.props(local.card)}>
      <span {...stylex.props(local.head)}>
        <Icon color={cssVar.colorSuccess} icon={CircleCheck} size={16} />
        <Text ellipsis>
          {title ? t('a2uiAction.submittedTitle', { title }) : t('a2uiAction.submitted')}
        </Text>
      </span>
      {fields.length > 0 && (
        <dl {...stylex.props(local.fields)}>
          {fields.map((field) => {
            const value = show(field.value);
            return [
              <dt key={`${field.key}:label`} {...stylex.props(local.label)}>
                {field.label}
              </dt>,
              <dd key={`${field.key}:value`} {...stylex.props(local.value, !value && local.empty)}>
                {value ?? t('a2uiAction.empty')}
              </dd>,
            ];
          })}
        </dl>
      )}
    </div>
  );
}

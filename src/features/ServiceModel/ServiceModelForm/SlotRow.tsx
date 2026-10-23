import { Flexbox, Select, type SelectOptions } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { type ModelRef, type SlotChoice } from '../serviceModelState';
import ModelLabel from './ModelLabel';
import { styles } from './styles';
import { type ModelKind, toOptionValue, useModelName, useModelOptions } from './useModelCatalog';

const FOLLOW_VALUE = '__follow__';
const OFF_VALUE = '__off__';

/** What a task row shows: the follow target, 「不启用」, or its own model. */
export type RowState = { kind: 'custom'; value: ModelRef } | { kind: 'follow' } | { kind: 'off' };

interface SlotRowProps {
  canDisable: boolean;
  /** Rows below the picker, e.g. a context limit for a pinned memory model. */
  children?: ReactNode;
  disabled?: boolean;
  /** Who the row follows: 主模型 / Flash 模型 / 向量化模型 / 系统推荐. */
  followLabel: string;
  /** The model the row runs when it follows, shown next to the follow item. */
  followModel?: ModelRef;
  modelKind: ModelKind;
  onChange: (choice: SlotChoice) => void;
  state: RowState;
  /** The picker's accessible name; the form row shows the task name as its label. */
  title: string;
}

/**
 * One task's picker. `Form.Field` supplies the name and the description; this
 * renders the borderless control plus anything the row needs under it.
 * Following and disabled rows read as gray text; only a pinned row shows an
 * icon and a model name. Picking the first item (the follow target) is how a
 * single row is restored.
 */
const SlotRow = ({
  canDisable,
  children,
  disabled,
  followLabel,
  followModel,
  modelKind,
  onChange,
  state,
  title,
}: SlotRowProps) => {
  const { t } = useTranslation('setting');
  const { groups, parseValue } = useModelOptions(modelKind);
  const getModelName = useModelName();

  const value =
    state.kind === 'custom'
      ? toOptionValue(state.value)
      : state.kind === 'off'
        ? OFF_VALUE
        : FOLLOW_VALUE;

  const options: SelectOptions = [
    {
      label: (
        <Flexbox
          horizontal
          align={'center'}
          gap={8}
          justify={'space-between'}
          style={{ width: '100%' }}
        >
          <span>{followLabel}</span>
          {followModel && <span {...stylex.props(styles.hint)}>{getModelName(followModel)}</span>}
        </Flexbox>
      ),
      title: followLabel,
      value: FOLLOW_VALUE,
    },
    ...groups,
    ...(canDisable
      ? [
          {
            className: stylex.props(styles.offOption).className,
            label: t('serviceModel.off'),
            title: t('serviceModel.off'),
            value: OFF_VALUE,
          },
        ]
      : []),
  ];

  return (
    <Flexbox gap={8}>
      <Select
        aria-label={title}
        classNames={{ value: stylex.props(styles.triggerValue).className }}
        disabled={disabled}
        options={options}
        style={{ width: '100%' }}
        value={value}
        variant={'borderless'}
        labelRender={() =>
          state.kind === 'custom' ? (
            <span {...stylex.props(styles.valueEnd)}>
              <ModelLabel model={state.value.model} name={getModelName(state.value)} />
            </span>
          ) : (
            <span {...stylex.props(styles.valueMuted)}>
              {state.kind === 'off' ? t('serviceModel.off') : followLabel}
            </span>
          )
        }
        onChange={(next) => {
          if (typeof next !== 'string' || next === value) return;
          if (next === FOLLOW_VALUE) onChange({ kind: 'follow' });
          else if (next === OFF_VALUE) onChange({ kind: 'off' });
          else onChange({ kind: 'custom', value: parseValue(next) });
        }}
      />
      {children}
    </Flexbox>
  );
};

export default SlotRow;

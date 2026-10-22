import { Flexbox, Select, type SelectOptions, Tooltip } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { type ReactNode, useId } from 'react';
import { useTranslation } from 'react-i18next';

import { type ModelRef, type SlotChoice } from '../serviceModelState';
import ModelLabel from './ModelLabel';
import { PICKER_WIDTH, styles } from './styles';
import { type ModelKind, toOptionValue, useModelName, useModelOptions } from './useModelCatalog';

const FOLLOW_VALUE = '__follow__';
const OFF_VALUE = '__off__';

/** What a task row shows: the follow target, 「不启用」, or its own model. */
export type RowState = { kind: 'custom'; value: ModelRef } | { kind: 'follow' } | { kind: 'off' };

interface SlotRowProps {
  canDisable: boolean;
  /** Rows below the main one, e.g. a context limit for a pinned memory model. */
  children?: ReactNode;
  disabled?: boolean;
  /** Why the picker is disabled; also shown as text above the form, since touch has no hover. */
  disabledReason?: string;
  /** Who the row follows: 主模型 / Flash 模型 / 向量化模型 / 系统推荐. */
  followLabel: string;
  /** The model the row runs when it follows, shown next to the follow item. */
  followModel?: ModelRef;
  modelKind: ModelKind;
  onChange: (choice: SlotChoice) => void;
  state: RowState;
  title: string;
}

/**
 * One task: its name on the left, a borderless picker in the shared right
 * column. Following and disabled rows read as gray text; only a pinned row
 * shows an icon and a model name. Picking the first item (the follow target)
 * is how a single row is restored.
 */
const SlotRow = ({
  canDisable,
  children,
  disabled,
  disabledReason,
  followLabel,
  followModel,
  modelKind,
  onChange,
  state,
  title,
}: SlotRowProps) => {
  const { t } = useTranslation('setting');
  const id = useId();
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
    <Flexbox>
      <Flexbox
        horizontal
        align={'center'}
        gap={24}
        justify={'space-between'}
        {...stylex.props(styles.row)}
      >
        {/* The picker takes no aria-label; the visible task name labels its trigger. */}
        <label
          htmlFor={id}
          {...stylex.props(styles.taskName, state.kind === 'off' && styles.taskNameOff)}
        >
          {title}
        </label>
        <Tooltip title={disabled ? disabledReason : undefined}>
          {/* A disabled trigger gets no hover events, so the tooltip hangs on a wrapper. */}
          <span style={{ display: 'flex', flex: 'none' }}>
            <Select
              classNames={{ value: stylex.props(styles.triggerValue).className }}
              disabled={disabled}
              id={id}
              options={options}
              style={{ flex: 'none', width: PICKER_WIDTH }}
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
          </span>
        </Tooltip>
      </Flexbox>
      {children}
    </Flexbox>
  );
};

export default SlotRow;

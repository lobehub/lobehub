import { Flexbox, Select, type SelectOptions, Tooltip } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { SettingsSearchAnchor } from '@/features/SettingsSearch/anchor';

import { type ModelRef } from '../serviceModelState';
import ModelLabel from './ModelLabel';
import { PICKER_WIDTH, styles } from './styles';
import { type ModelKind, toOptionValue, useModelName, useModelOptions } from './useModelCatalog';

const SYSTEM_VALUE = '__system__';

interface TierRowProps {
  /** Settings-search anchor id for this row's title. */
  anchor?: string;
  desc: string;
  disabled?: boolean;
  /** Why the picker is disabled; also shown as text above the form, since touch has no hover. */
  disabledReason?: string;
  modelKind: ModelKind;
  onChange: (value: ModelRef | undefined) => void;
  /** The model the system recommends for this tier right now. */
  recommended: ModelRef;
  title: string;
  /** The user's pick; `undefined` follows the system recommendation. */
  value?: ModelRef;
}

/**
 * A top-level model: title and scope on the left, a filled picker on the right.
 * 「系统推荐」 is said once, in the picker, next to the model it currently means.
 */
const TierRow = ({
  anchor,
  desc,
  disabled,
  disabledReason,
  modelKind,
  onChange,
  recommended,
  title,
  value,
}: TierRowProps) => {
  const { t } = useTranslation('setting');
  const id = useId();
  const { groups, parseValue } = useModelOptions(modelKind);
  const getModelName = useModelName();
  const systemLabel = t('serviceModel.systemRecommended');

  const selected = value ? toOptionValue(value) : SYSTEM_VALUE;
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
          <span>{systemLabel}</span>
          <span {...stylex.props(styles.hint)}>{getModelName(recommended)}</span>
        </Flexbox>
      ),
      title: systemLabel,
      value: SYSTEM_VALUE,
    },
    ...groups,
  ];

  return (
    <Flexbox horizontal align={'center'} gap={24} justify={'space-between'}>
      <Flexbox gap={2} style={{ minWidth: 0 }}>
        {/* The picker takes no aria-label; the visible title labels its trigger. */}
        <label htmlFor={id} {...stylex.props(styles.label)}>
          {anchor ? <SettingsSearchAnchor id={anchor}>{title}</SettingsSearchAnchor> : title}
        </label>
        <span {...stylex.props(styles.desc)}>{desc}</span>
      </Flexbox>
      <Tooltip title={disabled ? disabledReason : undefined}>
        {/* A disabled trigger gets no hover events, so the tooltip hangs on a wrapper. */}
        <span style={{ display: 'flex', flex: 'none' }}>
          <Select
            classNames={{ value: stylex.props(styles.triggerValue).className }}
            disabled={disabled}
            id={id}
            options={options}
            style={{ flex: 'none', width: PICKER_WIDTH }}
            value={selected}
            variant={'filled'}
            labelRender={() => {
              const current = value ?? recommended;
              return (
                <ModelLabel
                  hint={value ? undefined : systemLabel}
                  model={current.model}
                  name={getModelName(current)}
                />
              );
            }}
            onChange={(next) => {
              if (typeof next !== 'string' || next === selected) return;
              onChange(next === SYSTEM_VALUE ? undefined : parseValue(next));
            }}
          />
        </span>
      </Tooltip>
    </Flexbox>
  );
};

export default TierRow;

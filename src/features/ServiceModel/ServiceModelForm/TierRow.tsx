import { Flexbox, Select, type SelectOptions } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { useTranslation } from 'react-i18next';

import { type ModelRef } from '../serviceModelState';
import ModelLabel from './ModelLabel';
import { styles } from './styles';
import { type ModelKind, toOptionValue, useModelName, useModelOptions } from './useModelCatalog';

const SYSTEM_VALUE = '__system__';

interface TierRowProps {
  disabled?: boolean;
  modelKind: ModelKind;
  onChange: (value: ModelRef | undefined) => void;
  /** The model the system recommends for this tier right now. */
  recommended: ModelRef;
  /** The picker's accessible name; the form row shows the same text as its label. */
  title: string;
  /** The user's pick; `undefined` follows the system recommendation. */
  value?: ModelRef;
}

/**
 * A top-level model picker. `Form.Field` supplies the label and the scope text;
 * this renders only the control. 「系统推荐」 is said once, next to the model it
 * currently means.
 */
const TierRow = ({ disabled, modelKind, onChange, recommended, title, value }: TierRowProps) => {
  const { t } = useTranslation('setting');
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
    <Select
      aria-label={title}
      classNames={{ value: stylex.props(styles.triggerValue).className }}
      disabled={disabled}
      options={options}
      style={{ width: '100%' }}
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
  );
};

export default TierRow;

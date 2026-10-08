'use client';

import type { ExpertiseEnforcement } from '@lobechat/types';
import { Icon } from '@lobehub/ui';
import { Tooltip } from '@lobehub/ui/base-ui';
import { cx } from 'antd-style';
import { BellIcon, ShieldCheckIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { styles } from './styles';

interface EnforcementToggleProps {
  disabled?: boolean;
  onChange: (next: ExpertiseEnforcement) => void;
  value: ExpertiseEnforcement;
}

/**
 * The effect column is itself the switch: one click flips block ⇄ remind. It stops the click
 * from reaching the row, so flipping a rule does not also open it.
 */
const EnforcementToggle = ({ disabled, onChange, value }: EnforcementToggleProps) => {
  const { t } = useTranslation('memory');
  const isBlock = value === 'block';
  return (
    <Tooltip title={t(isBlock ? 'rules.enforcement.blockHint' : 'rules.enforcement.remindHint')}>
      <span
        className={cx(styles.modeBtn, isBlock ? styles.modeBlock : styles.modeRemind)}
        onClick={(e) => {
          e.stopPropagation();
          if (!disabled) onChange(isBlock ? 'remind' : 'block');
        }}
      >
        <Icon icon={isBlock ? ShieldCheckIcon : BellIcon} size={13} />
        {t(isBlock ? 'rules.enforcement.block' : 'rules.enforcement.remind')}
      </span>
    </Tooltip>
  );
};

export default EnforcementToggle;

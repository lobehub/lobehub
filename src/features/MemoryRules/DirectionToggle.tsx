'use client';

import type { ExpertiseRuleDirection } from '@lobechat/types';
import { Icon } from '@lobehub/ui';
import { Tooltip } from '@lobehub/ui/base-ui';
import { cx } from 'antd-style';
import { BanIcon, CircleDashedIcon, type LucideIcon, SparklesIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { styles } from './styles';

/** Shared with the document's property row, so the sheet and the document read the same. */
export const DIRECTION_ICON: Record<ExpertiseRuleDirection | 'unset', LucideIcon> = {
  negative: BanIcon,
  positive: SparklesIcon,
  unset: CircleDashedIcon,
};

interface DirectionToggleProps {
  disabled?: boolean;
  onChange: (next: ExpertiseRuleDirection) => void;
  value?: ExpertiseRuleDirection | null;
}

/**
 * The direction column is itself the switch, like the effect column: one click flips
 * positive ⇄ negative. A rule not judged yet shows a dashed mark; clicking it settles it as
 * positive, and the reviewer can flip on from there.
 */
const DirectionToggle = ({ disabled, onChange, value }: DirectionToggleProps) => {
  const { t } = useTranslation('memory');
  const key = value ?? 'unset';
  // Archived rules are never judged and cannot be switched, so do not promise either.
  const hint =
    disabled && !value ? t('rules.direction.unsetArchivedDesc') : t(`rules.direction.${key}Desc`);
  return (
    <Tooltip title={hint}>
      <span
        className={cx(
          styles.modeBtn,
          value === 'positive' && styles.directionPositive,
          value === 'negative' && styles.directionNegative,
          !value && styles.modeRemind,
        )}
        onClick={(e) => {
          e.stopPropagation();
          if (!disabled) onChange(value === 'positive' ? 'negative' : 'positive');
        }}
      >
        <Icon icon={DIRECTION_ICON[key]} size={13} />
        {value ? t(`rules.direction.${value}`) : '—'}
      </span>
    </Tooltip>
  );
};

export default DirectionToggle;

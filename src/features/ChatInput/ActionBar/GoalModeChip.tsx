'use client';

import { ActionIcon, Flexbox, Icon, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { TargetIcon, XIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatInputStore } from '../store';

const styles = createStaticStyles(({ css }) => ({
  chip: css`
    flex: none;

    height: 28px;
    padding-inline: 8px 4px;
    border-radius: 14px;

    background: ${cssVar.colorInfoBg};
  `,
  label: css`
    font-size: 12px;
    line-height: 1;
    color: ${cssVar.colorInfoText};
    white-space: nowrap;
  `,
}));

/**
 * Visible state for the hidden `/goal` send mode.
 *
 * This deliberately follows the heterogeneous input's armed-action chip
 * contract: it is a separate action-bar item immediately after the control
 * that armed it, and carries its own clear action.
 */
const GoalModeChip = memo(() => {
  const { t } = useTranslation('verify');
  const [goalMode, setGoalMode] = useChatInputStore((s) => [s.goalMode, s.setGoalMode]);

  if (!goalMode) return null;

  return (
    <Flexbox horizontal align={'center'} className={styles.chip} gap={4}>
      <Icon icon={TargetIcon} size={12} style={{ color: cssVar.colorInfoText }} />
      <Text className={styles.label}>{t('acceptance.tray.menuSetGoal')}</Text>
      <ActionIcon
        icon={XIcon}
        size={'small'}
        title={t('acceptance.tray.goalDisarm')}
        onClick={() => setGoalMode(false)}
      />
    </Flexbox>
  );
});

GoalModeChip.displayName = 'GoalModeChip';

export default GoalModeChip;

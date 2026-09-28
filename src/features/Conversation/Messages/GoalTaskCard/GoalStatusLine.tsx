'use client';

import type { GoalNodeStatus } from '@lobechat/types';
import { Flexbox, Icon } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import type { TargetIcon } from 'lucide-react';
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  CircleSlashIcon,
  Clock3Icon,
  LoaderCircleIcon,
  PauseCircleIcon,
  RefreshCwIcon,
  StampIcon,
} from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import GoalStepTrack from './GoalStepTrack';
import type { GoalTaskPhase } from './goalTaskProgress';

const PHASE_META = {
  achieved: { color: cssVar.colorSuccess, icon: CheckCircle2Icon, spin: false },
  canceled: { color: cssVar.colorTextTertiary, icon: CircleSlashIcon, spin: false },
  error: { color: cssVar.colorError, icon: AlertTriangleIcon, spin: false },
  paused: { color: cssVar.colorTextTertiary, icon: PauseCircleIcon, spin: false },
  repairing: { color: cssVar.colorWarning, icon: RefreshCwIcon, spin: true },
  review: { color: cssVar.colorWarning, icon: StampIcon, spin: false },
  running: { color: cssVar.colorInfo, icon: LoaderCircleIcon, spin: true },
  verifying: { color: cssVar.colorInfo, icon: LoaderCircleIcon, spin: true },
  waiting: { color: cssVar.colorTextSecondary, icon: Clock3Icon, spin: false },
} as const satisfies Record<
  GoalTaskPhase,
  { color: string; icon: typeof TargetIcon; spin: boolean }
>;

const styles = createStaticStyles(({ css }) => ({
  status: css`
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  statusIcon: css`
    flex-shrink: 0;
  `,
  track: css`
    flex: 1;
  `,
}));

export interface GoalStatusLineProps {
  passed: number;
  phase: GoalTaskPhase;
  statuses: GoalNodeStatus[];
  total: number;
}

/**
 * The live Goal status line — lifecycle phase word + the Tasks as a step track
 * + closed count. The phase word shows for every phase: it names the stage the
 * goal is in, which the track alone cannot. Once the goal is achieved the track
 * and count retire: "已达成" already implies full coverage, so repeating "4/4
 * 项通过" is noise.
 */
const GoalStatusLine = memo<GoalStatusLineProps>(({ passed, phase, statuses, total }) => {
  const { t } = useTranslation('chat');
  const meta = PHASE_META[phase];
  const showChecks = total > 0 && phase !== 'achieved';

  return (
    <Flexbox horizontal align={'center'} gap={6}>
      {phase !== 'running' && (
        <Icon
          className={styles.statusIcon}
          color={meta.color}
          icon={meta.icon}
          size={12}
          spin={meta.spin}
        />
      )}
      <Text className={styles.status}>{t(`goalTask.status.${phase}`)}</Text>
      {showChecks && (
        <>
          <Text className={styles.status}>·</Text>
          <Flexbox className={styles.track}>
            <GoalStepTrack statuses={statuses} total={total} />
          </Flexbox>
          <Text className={styles.status}>{t('goalTask.tasksDone', { passed, total })}</Text>
        </>
      )}
    </Flexbox>
  );
});

GoalStatusLine.displayName = 'GoalStatusLine';

export default GoalStatusLine;

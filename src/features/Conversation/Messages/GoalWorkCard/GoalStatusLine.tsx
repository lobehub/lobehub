'use client';

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

import type { GoalWorkPhase } from './goalWorkProgress';

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
  GoalWorkPhase,
  { color: string; icon: typeof TargetIcon; spin: boolean }
>;

const styles = createStaticStyles(({ css }) => ({
  progress: css`
    overflow: hidden;

    width: 72px;
    height: 3px;
    border-radius: 2px;

    background: ${cssVar.colorFillSecondary};
  `,
  progressFill: css`
    height: 100%;
    border-radius: inherit;
    background: ${cssVar.colorSuccess};
    transition: width 0.25s ease;
  `,
  status: css`
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  statusIcon: css`
    flex-shrink: 0;
  `,
}));

export interface GoalStatusLineProps {
  passed: number;
  phase: GoalWorkPhase;
  progress: number;
  total: number;
}

/**
 * The live Goal status line — phase icon + round budget + acceptance coverage.
 * Shared by the running tracker card and the merged task-callback header.
 * Once the goal is achieved the coverage bar retires: "已达成" already implies
 * full coverage, so repeating "4/4 项通过" is noise.
 */
const GoalStatusLine = memo<GoalStatusLineProps>(({ passed, phase, progress, total }) => {
  const { t } = useTranslation('chat');
  const meta = PHASE_META[phase];
  const showChecks = total > 0 && phase !== 'achieved';

  return (
    <Flexbox horizontal align={'center'} gap={6}>
      {phase !== 'running' && (
        <>
          <Icon
            className={styles.statusIcon}
            color={meta.color}
            icon={meta.icon}
            size={12}
            spin={meta.spin}
          />
          <Text className={styles.status}>{t(`goalWork.status.${phase}`)}</Text>
          <Text className={styles.status}>·</Text>
        </>
      )}
      {showChecks && (
        <>
          <div className={styles.progress}>
            <div className={styles.progressFill} style={{ width: `${progress}%` }} />
          </div>
          <Text className={styles.status}>{t('goalWork.workDone', { passed, total })}</Text>
        </>
      )}
    </Flexbox>
  );
});

GoalStatusLine.displayName = 'GoalStatusLine';

export default GoalStatusLine;

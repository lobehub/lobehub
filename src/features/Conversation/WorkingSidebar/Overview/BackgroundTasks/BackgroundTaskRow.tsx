import type { HeteroBackgroundTaskStatus } from '@lobechat/heterogeneous-agents';
import { formatDuration } from '@lobechat/utils';
import { ActionIcon, Icon, toast, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import {
  CircleCheckIcon,
  CircleSlashIcon,
  CircleStopIcon,
  CircleXIcon,
  FileTextIcon,
  type LucideIcon,
  RadarIcon,
  SquareIcon,
  SquareTerminalIcon,
} from 'lucide-react';
import { type MouseEvent, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import RingLoadingIcon from '@/components/RingLoading';

import { OverviewRow } from '../OverviewRow';
import type { BackgroundTaskItem, BackgroundTaskStopRoute } from './backgroundTaskList';
import { type StopBackgroundTaskFailure, useStopBackgroundTask } from './useStopBackgroundTask';

const styles = stylex.create({
  summary: {
    color: cssVar.colorTextTertiary,
    marginInlineStart: 6,
  },
});

const TOOL_ICONS: Record<string, LucideIcon> = { Bash: SquareTerminalIcon, Monitor: RadarIcon };

const STATUS_VISUAL: Record<
  Exclude<HeteroBackgroundTaskStatus, 'running'>,
  { color: string; icon: LucideIcon }
> = {
  completed: { color: cssVar.colorSuccess, icon: CircleCheckIcon },
  failed: { color: cssVar.colorError, icon: CircleXIcon },
  interrupted: { color: cssVar.colorWarning, icon: CircleSlashIcon },
  stopped: { color: cssVar.colorTextTertiary, icon: CircleStopIcon },
};

const FAILURE_KEYS = {
  failed: 'workingPanel.overview.backgroundTasks.stopFailed',
  noAnswer: 'workingPanel.overview.backgroundTasks.stopNoAnswer',
  upgradeLh: 'workingPanel.overview.backgroundTasks.stopUpgradeLh',
} as const satisfies Record<StopBackgroundTaskFailure, string>;

/** Epoch ms, ticking every second while `live`. */
const useNow = (live: boolean) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [live]);
  return now;
};

const stopClick = (handler: () => void) => (event: MouseEvent) => {
  event.stopPropagation();
  handler();
};

interface BackgroundTaskRowProps {
  item: BackgroundTaskItem;
  onLocate: (item: BackgroundTaskItem) => void;
  /** Opens the output file; absent when this client cannot read the run's files. */
  onViewOutput?: (path: string) => void;
  stopRoute?: BackgroundTaskStopRoute;
}

export const BackgroundTaskRow = ({
  item,
  onLocate,
  onViewOutput,
  stopRoute,
}: BackgroundTaskRowProps) => {
  const { t } = useTranslation('chat');
  const { status, task } = item;
  const running = status === 'running';
  const now = useNow(running);

  const onFailure = useCallback(
    (failure: StopBackgroundTaskFailure) => toast.error(t(FAILURE_KEYS[failure])),
    [t],
  );
  const { canStop, stop, stopping } = useStopBackgroundTask({
    onFailure,
    operationId: task.operationId,
    route: stopRoute,
    running,
    taskId: task.taskId,
  });

  const elapsed = formatDuration(Math.max(0, (task.endedAt ?? now) - task.startedAt), {
    pad: true,
  });
  const statusLabel = stopping
    ? t('workingPanel.overview.backgroundTasks.stopping')
    : t(`workingPanel.overview.backgroundTasks.status.${status}`);
  const summary =
    !running && task.summary && task.summary !== task.description ? task.summary : undefined;
  const visual = running ? undefined : STATUS_VISUAL[status as keyof typeof STATUS_VISUAL];
  const outputFile = task.outputFile;
  const hasActions = (!!outputFile && !!onViewOutput) || canStop;

  return (
    <OverviewRow
      icon={TOOL_ICONS[task.toolName] ?? SquareTerminalIcon}
      title={[task.description, summary].filter(Boolean).join('\n')}
      actions={
        hasActions ? (
          <>
            {outputFile && onViewOutput && (
              <ActionIcon
                icon={FileTextIcon}
                size={'small'}
                title={t('workingPanel.overview.backgroundTasks.viewOutput')}
                onClick={stopClick(() => onViewOutput(outputFile))}
              />
            )}
            {canStop && (
              <ActionIcon
                disabled={stopping}
                icon={SquareIcon}
                loading={stopping}
                size={'small'}
                title={
                  stopping
                    ? t('workingPanel.overview.backgroundTasks.stopping')
                    : t('workingPanel.overview.backgroundTasks.stop')
                }
                onClick={stopClick(() => void stop())}
              />
            )}
          </>
        ) : undefined
      }
      trailing={
        <>
          <span>{elapsed}</span>
          <Tooltip title={statusLabel}>
            <span aria-label={statusLabel} role={'img'}>
              {running ? (
                <RingLoadingIcon size={12} />
              ) : (
                <Icon icon={visual!.icon} size={14} style={{ color: visual!.color }} />
              )}
            </span>
          </Tooltip>
        </>
      }
      value={
        <>
          {task.description}
          {summary && <span {...stylex.props(styles.summary)}>{summary}</span>}
        </>
      }
      onClick={() => onLocate(item)}
    />
  );
};

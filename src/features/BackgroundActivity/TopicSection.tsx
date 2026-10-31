import { Button, Flexbox, Icon, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { RefreshCwIcon, SquareTerminalIcon, TriangleAlertIcon } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { isDesktop } from '@/const/version';
import {
  OverviewRow,
  rowStyles,
} from '@/features/Conversation/WorkingSidebar/Overview/OverviewRow';
import {
  sectionProps,
  sectionStyles,
} from '@/features/Conversation/WorkingSidebar/Overview/sectionStyles';

import {
  type Activity,
  formatCpu,
  formatMemory,
  refreshActivities,
  sumCpu,
  useActivities,
} from './state';
import StopButton from './StopButton';

const flash = stylex.keyframes({
  from: { backgroundColor: cssVar.colorWarningBg },
});

const styles = stylex.create({
  critical: { color: cssVar.colorError },
  metrics: { fontFamily: cssVar.fontFamilyCode, fontSize: '11.5px' },
  selected: {
    borderRadius: '8px',
    animationName: flash,
    animationDuration: '1.6s',
    animationTimingFunction: 'ease-out',
  },
  stale: { opacity: 0.55 },
  warning: { color: cssVar.colorWarning },
});

function ActivityRow({ activity, selected }: { activity: Activity; selected: boolean }) {
  const { t } = useTranslation('chat');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [selected]);
  const alert = activity.severity !== 'normal';
  const tone = activity.severity === 'critical' ? styles.critical : styles.warning;
  return (
    <div {...stylex.props(selected && styles.selected)} ref={ref}>
      <OverviewRow
        title={t('backgroundActivity.processCount', { count: activity.processes.length })}
        value={activity.label}
        iconNode={
          alert ? (
            <Tooltip title={t('backgroundActivity.highUsage')}>
              <Icon {...stylex.props(tone)} icon={TriangleAlertIcon} size={16} />
            </Tooltip>
          ) : (
            <Icon {...stylex.props(rowStyles.icon)} icon={SquareTerminalIcon} size={16} />
          )
        }
        trailing={
          <>
            <span {...stylex.props(styles.metrics, alert && tone)}>
              {formatMemory(activity.memoryMB)}
            </span>
            <span {...stylex.props(styles.metrics)}>{formatCpu(activity.cpuPercent)}</span>
            <StopButton rootId={activity.rootId} />
          </>
        }
      />
    </div>
  );
}

export function TopicBackgroundActivity({ topicId }: { topicId?: string }) {
  const { t } = useTranslation('chat');
  const state = useActivities();
  if (!isDesktop || !topicId || !state.loaded) return null;
  const activities = state.activities.filter((row) => row.topicId === topicId);
  if (activities.length === 0 && !state.error) return null;
  return (
    <Flexbox {...sectionProps()}>
      <Flexbox
        horizontal
        align={'center'}
        {...stylex.props(sectionStyles.sectionHeader)}
        justify={'space-between'}
      >
        <Flexbox horizontal align={'center'} gap={6}>
          <span {...stylex.props(sectionStyles.sectionTitle)}>{t('backgroundActivity.title')}</span>
          {activities.length > 0 && (
            <span {...stylex.props(sectionStyles.count)}>{activities.length}</span>
          )}
        </Flexbox>
        {activities.length > 1 && (
          <span {...stylex.props(rowStyles.rowTrailing, styles.metrics)}>
            {formatMemory(activities.reduce((sum, row) => sum + row.memoryMB, 0))} ·{' '}
            {formatCpu(sumCpu(activities))}
          </span>
        )}
      </Flexbox>
      {state.error && (
        <OverviewRow
          danger
          icon={TriangleAlertIcon}
          iconColor={cssVar.colorError}
          title={t('backgroundActivity.unavailable')}
          value={t('backgroundActivity.unavailable')}
          trailing={
            <Button
              icon={<Icon icon={RefreshCwIcon} size={12} />}
              size={'small'}
              onClick={() => void refreshActivities()}
            >
              {t('backgroundActivity.retry')}
            </Button>
          }
        />
      )}
      <div {...stylex.props(state.error && styles.stale)}>
        {activities.map((activity) => (
          <ActivityRow
            activity={activity}
            key={activity.rootId}
            selected={state.selected === activity.rootId}
          />
        ))}
      </div>
    </Flexbox>
  );
}

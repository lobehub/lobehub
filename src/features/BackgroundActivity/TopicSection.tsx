import { Button, createStaticStyles, cssVar, cx, Flexbox, Icon, Tooltip } from '@lobehub/ui';
import { RefreshCwIcon, SquareTerminalIcon, TriangleAlertIcon } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { isDesktop } from '@/const/version';
import {
  OverviewRow,
  rowStyles,
} from '@/features/Conversation/WorkingSidebar/Overview/OverviewRow';
import { sectionStyles } from '@/features/Conversation/WorkingSidebar/Overview/sectionStyles';

import {
  type Activity,
  formatCpu,
  formatMemory,
  refreshActivities,
  sumCpu,
  useActivities,
} from './state';
import StopButton from './StopButton';

const styles = createStaticStyles(({ css }) => ({
  critical: css`
    color: ${cssVar.colorError};
  `,
  metrics: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: 11.5px;
  `,
  selected: css`
    @keyframes background-activity-flash {
      from {
        background: ${cssVar.colorWarningBg};
      }
    }

    border-radius: 8px;
    animation: background-activity-flash 1.6s ease-out;
  `,
  stale: css`
    opacity: 0.55;
  `,
  warning: css`
    color: ${cssVar.colorWarning};
  `,
}));

function ActivityRow({ activity, selected }: { activity: Activity; selected: boolean }) {
  const { t } = useTranslation('chat');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [selected]);
  const alert = activity.severity !== 'normal';
  const tone = activity.severity === 'critical' ? styles.critical : styles.warning;
  return (
    <div className={cx(selected && styles.selected)} ref={ref}>
      <OverviewRow
        title={t('backgroundActivity.processCount', { count: activity.processes.length })}
        value={activity.label}
        iconNode={
          alert ? (
            <Tooltip title={t('backgroundActivity.highUsage')}>
              <Icon className={tone} icon={TriangleAlertIcon} size={16} />
            </Tooltip>
          ) : (
            <Icon className={rowStyles.icon} icon={SquareTerminalIcon} size={16} />
          )
        }
        trailing={
          <>
            <span className={cx(styles.metrics, alert && tone)}>
              {formatMemory(activity.memoryMB)}
            </span>
            <span className={styles.metrics}>{formatCpu(activity.cpuPercent)}</span>
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
    <Flexbox className={sectionStyles.section}>
      <Flexbox
        horizontal
        align={'center'}
        className={sectionStyles.sectionHeader}
        justify={'space-between'}
      >
        <Flexbox horizontal align={'center'} gap={6}>
          <span className={sectionStyles.sectionTitle}>{t('backgroundActivity.title')}</span>
          {activities.length > 0 && (
            <span className={sectionStyles.count}>{activities.length}</span>
          )}
        </Flexbox>
        {activities.length > 1 && (
          <span className={cx(rowStyles.rowTrailing, styles.metrics)}>
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
      <div className={cx(state.error && styles.stale)}>
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

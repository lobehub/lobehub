import { Block, Flexbox, Icon, Text, Tooltip } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { ClockIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  formatIntervalLabel,
  formatScheduleDescription,
  formatTimezoneName,
} from '@/features/AgentTasks/AgentTaskDetail/scheduler/helpers';

interface TaskTriggerTagProps {
  automationMode?: 'heartbeat' | 'schedule' | null;
  heartbeatInterval?: number | null;
  mode?: 'inline' | 'tag';
  schedulePattern?: string | null;
  scheduleTimezone?: string | null;
}

const TaskTriggerTag = memo<TaskTriggerTagProps>(
  ({ automationMode, heartbeatInterval, mode = 'tag', schedulePattern, scheduleTimezone }) => {
    const { t, i18n } = useTranslation('chat');
    const data = useMemo<
      | {
          primary: string;
          secondary?: string;
          tooltip: string;
        }
      | undefined
    >(() => {
      // automationMode is the source of truth — DB may carry stale fields from
      // a previous mode (e.g. a heartbeat task that was once on a schedule).
      if (automationMode === 'schedule' && schedulePattern) {
        const primary = formatScheduleDescription(schedulePattern, t);
        const tzName = scheduleTimezone
          ? formatTimezoneName(scheduleTimezone, i18n.language)
          : undefined;
        return {
          primary,
          secondary: tzName,
          tooltip: tzName ? `${primary} · ${tzName}` : primary,
        };
      }

      if (automationMode === 'heartbeat' && heartbeatInterval && heartbeatInterval > 0) {
        const every = t('taskSchedule.tag.every', {
          interval: formatIntervalLabel(heartbeatInterval, t),
        });
        return {
          primary: every,
          tooltip: t('taskSchedule.tag.heartbeat', { every }),
        };
      }

      return undefined;
    }, [automationMode, heartbeatInterval, schedulePattern, scheduleTimezone, t, i18n.language]);

    if (mode === 'inline') {
      // Keep the inline row to a single line regardless of mode so toggling
      // schedule ↔ heartbeat from the popover above doesn't reflow the rows
      // below. The timezone (if any) is still surfaced — just via the hover
      // tooltip — so we don't lose information.
      return (
        <Tooltip title={data?.tooltip}>
          <Flexbox horizontal align="center" gap={10}>
            <Icon color={cssVar.colorTextDescription} icon={ClockIcon} size={16} />
            <Text type={data ? undefined : 'secondary'} weight={data ? 500 : undefined}>
              {data?.primary ?? t('taskSchedule.tag.add')}
            </Text>
          </Flexbox>
        </Tooltip>
      );
    }

    if (!data) return null;

    // Pill height (24px) only fits one line — drop the timezone here; the
    // tooltip surfaces it on hover.
    return (
      <Tooltip title={data.tooltip}>
        <Block
          horizontal
          align={'center'}
          gap={4}
          height={24}
          paddingInline={'4px 8px'}
          style={{ borderRadius: 24 }}
          variant={'outlined'}
        >
          <Icon color={cssVar.colorTextDescription} icon={ClockIcon} size={16} />
          <Text fontSize={12} type={'secondary'}>
            {data.primary}
          </Text>
        </Block>
      </Tooltip>
    );
  },
);

export default TaskTriggerTag;

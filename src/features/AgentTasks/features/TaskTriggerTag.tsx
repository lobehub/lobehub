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
  heartbeatInterval?: number | null;
  mode?: 'inline' | 'tag';
  schedulePattern?: string | null;
  scheduleTimezone?: string | null;
}

const TaskTriggerTag = memo<TaskTriggerTagProps>(
  ({ heartbeatInterval, mode = 'tag', schedulePattern, scheduleTimezone }) => {
    const { t, i18n } = useTranslation('chat');
    const data = useMemo(() => {
      if (schedulePattern) {
        const description = formatScheduleDescription(schedulePattern, t);
        const tzName = scheduleTimezone ? formatTimezoneName(scheduleTimezone, i18n.language) : '';
        const text = tzName
          ? t('taskSchedule.summary.schedule', { description, timezone: tzName })
          : description;
        return {
          // Tooltip exposes the raw cron + IANA id for power users / debugging.
          tooltip: scheduleTimezone ? `${schedulePattern} (${scheduleTimezone})` : schedulePattern,
          text,
        };
      }

      if (heartbeatInterval && heartbeatInterval > 0) {
        const every = t('taskSchedule.tag.every', {
          interval: formatIntervalLabel(heartbeatInterval, t),
        });
        return {
          tooltip: t('taskSchedule.tag.heartbeat', { every }),
          text: every,
        };
      }

      return undefined;
    }, [heartbeatInterval, schedulePattern, scheduleTimezone, t, i18n.language]);

    if (mode === 'inline') {
      return (
        <Tooltip title={data?.tooltip}>
          <Flexbox horizontal align="center" gap={10}>
            <Icon color={cssVar.colorTextDescription} icon={ClockIcon} size={16} />
            <Text type={data ? undefined : 'secondary'} weight={data ? 500 : undefined}>
              {data?.text ?? t('taskSchedule.tag.add')}
            </Text>
          </Flexbox>
        </Tooltip>
      );
    }

    if (!data) return null;

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
            {data.text}
          </Text>
        </Block>
      </Tooltip>
    );
  },
);

export default TaskTriggerTag;

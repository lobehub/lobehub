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
    const data = useMemo<
      | {
          primary: string;
          secondary?: string;
          tooltip: string;
        }
      | undefined
    >(() => {
      if (schedulePattern) {
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

      if (heartbeatInterval && heartbeatInterval > 0) {
        const every = t('taskSchedule.tag.every', {
          interval: formatIntervalLabel(heartbeatInterval, t),
        });
        return {
          primary: every,
          tooltip: t('taskSchedule.tag.heartbeat', { every }),
        };
      }

      return undefined;
    }, [heartbeatInterval, schedulePattern, scheduleTimezone, t, i18n.language]);

    if (mode === 'inline') {
      return (
        <Tooltip title={data?.tooltip}>
          <Flexbox horizontal align="flex-start" gap={10}>
            <Icon
              color={cssVar.colorTextDescription}
              icon={ClockIcon}
              size={16}
              style={{ marginTop: 2 }}
            />
            <Flexbox gap={2}>
              <Text type={data ? undefined : 'secondary'} weight={data ? 500 : undefined}>
                {data?.primary ?? t('taskSchedule.tag.add')}
              </Text>
              {data?.secondary && (
                <Text style={{ color: cssVar.colorTextDescription, fontSize: 11 }}>
                  {data.secondary}
                </Text>
              )}
            </Flexbox>
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

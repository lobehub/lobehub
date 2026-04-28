import { Block, Flexbox, Icon, Text, Tooltip } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import type { TFunction } from 'i18next';
import { ClockIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

const formatInterval = (seconds: number, t: TFunction<'chat'>) => {
  if (seconds < 60) return t('taskSchedule.unit.second', { count: seconds });
  if (seconds % 3600 === 0) return t('taskSchedule.unit.hour', { count: seconds / 3600 });
  if (seconds % 60 === 0) return t('taskSchedule.unit.minute', { count: seconds / 60 });
  return t('taskSchedule.unit.second', { count: seconds });
};

interface TaskTriggerTagProps {
  heartbeatInterval?: number | null;
  mode?: 'inline' | 'tag';
  schedulePattern?: string | null;
  scheduleTimezone?: string | null;
}

const TaskTriggerTag = memo<TaskTriggerTagProps>(
  ({ heartbeatInterval, mode = 'tag', schedulePattern, scheduleTimezone }) => {
    const { t } = useTranslation('chat');
    const data = useMemo(() => {
      if (schedulePattern) {
        const timezone = scheduleTimezone ? ` (${scheduleTimezone})` : '';
        return {
          tooltip: t('taskSchedule.tag.schedule', {
            schedule: schedulePattern,
            timezone,
          }),
          text: `${schedulePattern} ${timezone}`,
        };
      }

      if (heartbeatInterval && heartbeatInterval > 0) {
        const every = t('taskSchedule.tag.every', {
          interval: formatInterval(heartbeatInterval, t),
        });
        return {
          tooltip: t('taskSchedule.tag.heartbeat', { every }),
          text: every,
        };
      }

      return undefined;
    }, [heartbeatInterval, schedulePattern, scheduleTimezone, t]);

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

import { Block, Flexbox, Icon, Text, Tooltip } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { ClockIcon } from 'lucide-react';
import { memo, useMemo } from 'react';

const formatInterval = (seconds: number) => {
  if (seconds < 60) return `${seconds}s`;
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
};

interface TaskTriggerTagProps {
  heartbeatInterval?: number | null;
  mode?: 'inline' | 'tag';
  schedulePattern?: string | null;
  scheduleTimezone?: string | null;
}

const TaskTriggerTag = memo<TaskTriggerTagProps>(
  ({ heartbeatInterval, mode = 'tag', schedulePattern, scheduleTimezone }) => {
    const data = useMemo(() => {
      if (schedulePattern) {
        const timezone = scheduleTimezone ? ` (${scheduleTimezone})` : '';
        return {
          tooltip: `Schedule · ${schedulePattern} ${timezone}`,
          text: `${schedulePattern} ${timezone}`,
        };
      }

      if (heartbeatInterval && heartbeatInterval > 0) {
        return {
          tooltip: `Heartbeat · every ${formatInterval(heartbeatInterval)}`,
          text: `every ${formatInterval(heartbeatInterval)}`,
        };
      }

      return undefined;
    }, [heartbeatInterval, schedulePattern, scheduleTimezone]);

    if (mode === 'inline') {
      return (
        <Tooltip title={data?.tooltip}>
          <Flexbox horizontal align="center" gap={10}>
            <Icon color={cssVar.colorTextDescription} icon={ClockIcon} size={16} />
            <Text type={data ? undefined : 'secondary'}>
              {data?.text ?? 'Add schedule/trigger'}
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

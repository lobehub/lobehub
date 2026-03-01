import { Text } from '@lobehub/ui';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { memo } from 'react';

dayjs.extend(relativeTime);

export const Time = memo<{ date: string | number | Date }>(({ date }) => {
  return (
    <Text fontSize={12} style={{ flex: 'none' }} type={'secondary'}>
      {dayjs(date || dayjs().date()).fromNow()}
    </Text>
  );
});

export default Time;

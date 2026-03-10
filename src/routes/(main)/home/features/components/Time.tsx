import { Text } from '@lobehub/ui';
import dayjs from 'dayjs';
import { memo } from 'react';

export const Time = memo<{ date: string | number | Date }>(({ date }) => {
  return (
    <Text fontSize={12} style={{ flex: 'none' }} type={'secondary'}>
      {dayjs(date || dayjs().date()).fromNow()}
    </Text>
  );
});

export default Time;

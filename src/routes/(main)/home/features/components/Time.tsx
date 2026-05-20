import { Text } from '@lobehub/ui';
import { memo } from 'react';

import { useActivityTime } from '@/hooks/useActivityTime';

export const Time = memo<{ date: string | number | Date }>(({ date }) => {
  const { text, title } = useActivityTime(date);
  if (!text) return null;
  return (
    <Text fontSize={12} style={{ flex: 'none' }} title={title} type={'secondary'}>
      {text}
    </Text>
  );
});

export default Time;

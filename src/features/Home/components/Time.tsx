import { Text } from '@lobehub/ui';
import { memo } from 'react';

import { useActivityTime } from '@/hooks/useActivityTime';

import { homeType } from './homeType';

export const Time = memo<{ date: string | number | Date }>(({ date }) => {
  const { text, title } = useActivityTime(date);
  if (!text) return null;
  return (
    <Text className={homeType.meta} style={{ flex: 'none' }} title={title}>
      {text}
    </Text>
  );
});

export default Time;

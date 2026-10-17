import { Text } from '@lobehub/ui';
import { memo } from 'react';

import { useActivityTime } from '@/hooks/useActivityTime';

interface TimeProps {
  capturedAt?: Date | number | string;
}

const Time = memo<TimeProps>(({ capturedAt }) => {
  const { text, title } = useActivityTime(capturedAt);
  if (!text) return null;

  return (
    <Text
      as={'time'}
      fontSize={12}
      style={{ display: 'block', flex: 'none' }}
      title={title}
      type={'secondary'}
    >
      {text}
    </Text>
  );
});

export default Time;

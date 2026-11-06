import { Text } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

import { useActivityTime } from '@/hooks/useActivityTime';

import { homeType } from './homeType';

interface TimeProps {
  date: string | number | Date;
  /**
   * Reserve a fixed slot and right-align the text in it, so a list of rows
   * shows one straight time column even though relative and absolute forms
   * differ in width. Wider-than-slot text still lays out normally.
   */
  minWidth?: number;
}

export const Time = memo<TimeProps>(({ date, minWidth }) => {
  const { text, title } = useActivityTime(date);
  if (!text) return null;
  return (
    <Text
      className={stylex.props(homeType.meta).className}
      style={{ flex: 'none', minWidth, textAlign: minWidth === undefined ? undefined : 'end' }}
      title={title}
    >
      {text}
    </Text>
  );
});

export default Time;

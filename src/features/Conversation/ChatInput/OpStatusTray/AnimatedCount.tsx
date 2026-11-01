import { memo } from 'react';

import { useAnimatedCount } from './useAnimatedCount';

interface AnimatedCountProps {
  format: (value: number) => string;
  value: number;
}

const AnimatedCount = memo<AnimatedCountProps>(({ format, value }) => (
  <>{useAnimatedCount(value, format)}</>
));

AnimatedCount.displayName = 'AnimatedCount';

export default AnimatedCount;

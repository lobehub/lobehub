import { cssVar as sxVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

import { sx } from '@/styles/sx';

const styles = stylex.create({
  dot: {
    flex: 'none',
    width: 8,
    height: 8,
    borderRadius: '50%',
    backgroundColor: sxVar.colorTextQuaternary,
  },
});

interface TaskLabelDotProps {
  /** Hex color from the registry (validated server-side); falls back to a neutral token. */
  color?: string | null;
  size?: number;
}

const TaskLabelDot = memo<TaskLabelDotProps>(({ color, size }) => (
  <span
    aria-hidden
    {...sx([styles.dot], undefined, {
      ...(color ? { backgroundColor: color } : undefined),
      ...(size ? { height: size, width: size } : undefined),
    })}
  />
));

TaskLabelDot.displayName = 'TaskLabelDot';

export default TaskLabelDot;

'use client';

import { Checkbox, Flexbox, Skeleton } from '@lobehub/ui';
import { memo } from 'react';

import { styles } from './style';
import type { StarterTaskRow as StarterTaskRowModel } from './useStarterTasks';

export const TaskRowSkeleton = memo(() => (
  <Flexbox horizontal align={'center'} className={styles.row} gap={12}>
    <Skeleton.Button active shape={'circle'} size={'small'} style={{ height: 20, width: 20 }} />
    <Skeleton.Button active size={'small'} style={{ height: 16, width: 220 }} />
  </Flexbox>
));
TaskRowSkeleton.displayName = 'StarterTaskRowSkeleton';

interface TaskRowProps extends StarterTaskRowModel {
  onToggle: (id: string) => void;
}

const TaskRow = memo<TaskRowProps>(({ checked, id, onToggle, title }) => (
  <Checkbox
    checked={checked}
    classNames={{ text: styles.rowLabel, wrapper: styles.row }}
    shape={'circle'}
    onChange={() => onToggle(id)}
  >
    {title}
  </Checkbox>
));

TaskRow.displayName = 'StarterTaskRow';

export default TaskRow;

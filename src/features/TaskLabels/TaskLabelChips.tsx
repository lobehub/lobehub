import type { TaskLabelRef } from '@lobechat/types';
import { Flexbox, Text, Tooltip } from '@lobehub/ui';
import { cssVar as sxVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

import TaskLabelDot from './TaskLabelDot';

const styles = stylex.create({
  chip: {
    display: 'inline-flex',
    flex: 'none',
    gap: 6,
    alignItems: 'center',
    maxWidth: 140,
    height: 20,
    paddingInline: 8,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: sxVar.colorBorderSecondary,
    borderRadius: 10,
    fontSize: 12,
    lineHeight: 1,
    color: sxVar.colorTextSecondary,
  },
});

interface TaskLabelChipProps {
  label: Pick<TaskLabelRef, 'color' | 'name'>;
}

export const TaskLabelChip = memo<TaskLabelChipProps>(({ label }) => (
  <span {...stylex.props(styles.chip)}>
    <TaskLabelDot color={label.color} />
    <Text ellipsis fontSize={12} type={'secondary'}>
      {label.name}
    </Text>
  </span>
));

TaskLabelChip.displayName = 'TaskLabelChip';

interface TaskLabelChipsProps {
  labels?: TaskLabelRef[] | null;
  /** Chips shown before the rest collapse into a "+N" chip with a tooltip. */
  max?: number;
}

/** A task's labels as colored chips, for list rows, board cards and the detail page. */
const TaskLabelChips = memo<TaskLabelChipsProps>(({ labels, max = 3 }) => {
  if (!labels?.length) return null;
  const shown = labels.slice(0, max);
  const hidden = labels.slice(max);

  return (
    <Flexbox horizontal align={'center'} gap={4} style={{ minWidth: 0, overflow: 'hidden' }}>
      {shown.map((label) => (
        <TaskLabelChip key={label.id} label={label} />
      ))}
      {hidden.length > 0 && (
        <Tooltip title={hidden.map((label) => label.name).join(', ')}>
          <span {...stylex.props(styles.chip)}>+{hidden.length}</span>
        </Tooltip>
      )}
    </Flexbox>
  );
});

TaskLabelChips.displayName = 'TaskLabelChips';

export default TaskLabelChips;

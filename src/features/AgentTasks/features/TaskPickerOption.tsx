'use client';

import { Flexbox } from '@lobehub/ui';
import { type ReactNode } from 'react';

import { taskExecutionStyles as styles } from './taskExecutionStyles';

interface TaskPickerOptionProps {
  /**
   * Selection state, reported as `aria-pressed`. Omit it for a row that TRIGGERS
   * something instead of holding a state (the directory picker's "add folder"):
   * the row is still a button, it just has nothing to be "on".
   */
  checked?: boolean;
  children: ReactNode;
  disabled?: boolean;
  onSelect: () => void;
}

/**
 * A selectable row inside a task picker popover.
 *
 * A real `<button>`, because these rows used to be plain `Flexbox` divs with an
 * `onClick`: no role, no tab stop and no activation key, so a keyboard user
 * could open a picker and then had no way to choose or clear anything in it. The
 * native element gives the row its semantics, its focus stop and Enter/Space
 * activation for free, in the one place the device, repository and directory
 * pickers share — so they cannot drift apart into three different keyboard
 * stories again.
 *
 * `aria-pressed` reports the selection. It fits both shapes these lists take
 * (one-of for a run target, many-of for repositories), so one row serves both
 * instead of each picker inventing its own state semantics.
 */
export const TaskPickerOption = ({
  checked,
  children,
  disabled,
  onSelect,
}: TaskPickerOptionProps) => (
  <button
    aria-pressed={checked === undefined ? undefined : checked}
    className={`${styles.row} ${checked ? styles.rowActive : ''}`}
    disabled={disabled}
    type={'button'}
    onClick={onSelect}
  >
    <Flexbox horizontal align={'center'} gap={8}>
      {children}
    </Flexbox>
  </button>
);

export default TaskPickerOption;

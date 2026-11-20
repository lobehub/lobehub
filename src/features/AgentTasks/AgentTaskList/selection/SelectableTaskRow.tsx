'use client';

import { Checkbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import type { MouseEvent, ReactNode } from 'react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useTaskSelectionStore } from './store';

const styles = stylex.create({
  // Spans the row's full height and centres the box in it. The checkbox is
  // `inline-flex`; in a plain block it sits on the baseline of a taller line
  // box and ends up above the row's centre.
  check: {
    alignItems: 'center',
    display: 'flex',
    insetBlock: 0,
    insetInlineStart: 6,
    opacity: 0,
    position: 'absolute',
    transition: 'opacity 0.12s',
    zIndex: 1,
  },
  checkVisible: {
    opacity: 1,
  },
  // The row paints hover and selection over its full width, gutter included;
  // the task item inside drops its own hover fill (`selectableTaskItemClassName`),
  // or the two layers read as a separate block beside the checkbox gutter.
  row: {
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillTertiary },
    borderRadius: cssVar.borderRadius,
    // Gutter for the checkbox, so it never sits on the priority icon or gets
    // clipped by the panel edge.
    paddingInlineStart: 20,
    position: 'relative',
    transition: 'background-color 0.12s',
  },
  // Translucent accent fills: `colorInfoBg` is near-white on light themes and
  // reads fainter than the plain hover fill.
  selected: {
    backgroundColor: {
      'default': cssVar.colorInfoFillTertiary,
      ':hover': cssVar.colorInfoFillSecondary,
    },
  },
});

const itemStyles = stylex.create({
  item: {
    backgroundColor: 'transparent',
  },
});

/** Class for the row's task item: the row owns hover and selection. */
export const selectableTaskItemClassName = stylex.props(itemStyles.item).className;

interface SelectableTaskRowProps {
  children: ReactNode;
  id: string;
  /** Names the row's checkbox for assistive technology, e.g. "T-12 Fix login". */
  label: string;
  /** Selectable ids of the list, top to bottom — the Shift+click range. */
  order: () => readonly string[];
}

/**
 * Selection chrome around a task row: a checkbox in the gutter (on hover, or
 * always once anything is selected), ⌘/Ctrl+click to toggle and Shift+click to
 * select a range. A plain click keeps opening the task.
 */
const SelectableTaskRow = memo<SelectableTaskRowProps>(({ children, id, label, order }) => {
  const selected = useTaskSelectionStore((s) => s.selectedIds.includes(id));
  const selecting = useTaskSelectionStore((s) => s.selectedIds.length > 0);
  const frozen = useTaskSelectionStore((s) => !!s.progress);
  const { t } = useTranslation('chat');
  const [hovered, setHovered] = useState(false);

  const handleClickCapture = useCallback(
    (event: MouseEvent) => {
      const { selectRange, toggle } = useTaskSelectionStore.getState();
      if (event.shiftKey) selectRange(order(), id);
      else if (event.metaKey || event.ctrlKey) toggle(id);
      else return;
      event.preventDefault();
      event.stopPropagation();
    },
    [id, order],
  );

  const handleCheck = useCallback(
    (event: MouseEvent) => {
      event.stopPropagation();
      const { selectRange, toggle } = useTaskSelectionStore.getState();
      if (event.shiftKey) selectRange(order(), id);
      else toggle(id);
    },
    [id, order],
  );

  return (
    <div
      {...stylex.props(styles.row, selected && styles.selected)}
      data-selected={selected || undefined}
      onClickCapture={handleClickCapture}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        {...stylex.props(styles.check, (selecting || hovered) && styles.checkVisible)}
        data-testid={'task-row-checkbox'}
        onClickCapture={handleCheck}
      >
        <Checkbox
          aria-label={t('taskList.bulk.selectTask', { task: label })}
          backgroundColor={cssVar.colorInfo}
          checked={selected}
          disabled={frozen}
          size={16}
          // White tick on the accent fill in both themes; the default tick
          // colour follows the page background and goes dark on dark mode.
          style={{ color: cssVar.colorTextLightSolid }}
        />
      </div>
      {children}
    </div>
  );
});

SelectableTaskRow.displayName = 'SelectableTaskRow';

export default SelectableTaskRow;

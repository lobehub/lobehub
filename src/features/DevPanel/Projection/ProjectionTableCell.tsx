'use client';

import { createStaticStyles, cssVar, cx } from 'antd-style';
import { memo } from 'react';

import type { ProjectionTableCell as ProjectionTableCellModel } from './model';
import ProjectionCellEditorInput from './ProjectionCellEditorInput';
import type { ProjectionCellEditorController } from './useProjectionCellEditor';

const styles = createStaticStyles(({ css }) => ({
  editable: css`
    cursor: text;

    &:hover {
      box-shadow: inset 0 0 0 1px ${cssVar.colorBorder};
    }
  `,
  editing: css`
    overflow: visible !important;
    padding: 0 !important;
    background: ${cssVar.colorBgContainer};
  `,
  nullValue: css`
    color: ${cssVar.colorTextQuaternary};
  `,
}));

interface ProjectionTableCellProps {
  cell: ProjectionTableCellModel;
  editor: ProjectionCellEditorController;
}

const ProjectionTableCell = memo<ProjectionTableCellProps>(
  ({ cell, editor }) => {
    const active = editor.activeCell?.key === cell.key;

    if (active) {
      return (
        <td className={styles.editing} title={editor.error ?? undefined}>
          <ProjectionCellEditorInput cell={cell} editor={editor} />
        </td>
      );
    }

    return (
      <td
        title={cell.editTarget ? `${cell.title}\nDouble-click to edit.` : cell.title}
        className={cx(
          cell.editTarget ? styles.editable : undefined,
          cell.value == null ? styles.nullValue : undefined,
        )}
        onDoubleClick={cell.editTarget ? () => void editor.begin(cell) : undefined}
      >
        {cell.displayValue}
      </td>
    );
  },
  (previous, next) => {
    if (
      previous.cell.key !== next.cell.key ||
      previous.cell.value !== next.cell.value ||
      previous.cell.displayValue !== next.cell.displayValue ||
      Boolean(previous.cell.editTarget) !== Boolean(next.cell.editTarget)
    ) {
      return false;
    }

    const wasActive = previous.editor.activeCell?.key === previous.cell.key;
    const isActive = next.editor.activeCell?.key === next.cell.key;
    if (wasActive !== isActive) return false;
    if (!isActive) return true;

    return (
      previous.editor.draft === next.editor.draft &&
      previous.editor.error === next.editor.error &&
      previous.editor.isApplying === next.editor.isApplying
    );
  },
);

ProjectionTableCell.displayName = 'ProjectionTableCell';

export default ProjectionTableCell;

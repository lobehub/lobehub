'use client';

import { Input, Switch } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { memo } from 'react';

import type { ProjectionTableCell } from './model';
import type { ProjectionCellEditorController } from './useProjectionCellEditor';

const styles = createStaticStyles(({ css }) => ({
  booleanEditor: css`
    display: flex;
    gap: 8px;
    align-items: center;

    width: 100%;
    min-height: 31px;
    padding-inline: 8px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeSM};

    background: ${cssVar.colorBgContainer};
    box-shadow: inset 0 0 0 2px ${cssVar.colorPrimary};
  `,
  input: css`
    width: 100%;
    height: 31px;
    border-radius: 0;

    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeSM};

    background: ${cssVar.colorBgContainer};
    box-shadow: inset 0 0 0 2px ${cssVar.colorPrimary};

    input {
      font-family: inherit;
    }
  `,
  inputError: css`
    box-shadow: inset 0 0 0 2px ${cssVar.colorError};
  `,
}));

interface ProjectionCellEditorInputProps {
  cell: ProjectionTableCell;
  editor: ProjectionCellEditorController;
}

const ProjectionCellEditorInput = memo<ProjectionCellEditorInputProps>(({ cell, editor }) => {
  if (typeof cell.value === 'boolean') {
    const checked = editor.draft === 'true';
    return (
      <div
        className={styles.booleanEditor}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Escape') editor.cancel();
        }}
      >
        <Switch
          autoFocus
          disabled={editor.isApplying}
          loading={editor.isApplying}
          size={'small'}
          value={checked}
          onChange={(value, event) => {
            event.stopPropagation();
            editor.setDraft(String(value));
            void editor.commit();
          }}
        />
        <span>{String(checked)}</span>
      </div>
    );
  }

  return (
    <Input
      autoFocus
      aria-invalid={Boolean(editor.error)}
      aria-label={`Edit ${cell.column.label}`}
      className={cx(styles.input, editor.error ? styles.inputError : undefined)}
      disabled={editor.isApplying}
      inputMode={typeof cell.value === 'number' ? 'decimal' : undefined}
      title={editor.error ?? undefined}
      value={editor.draft}
      variant={'borderless'}
      onBlur={() => void editor.commit()}
      onChange={(event) => editor.setDraft(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onFocus={(event) => event.currentTarget.select()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter') {
          event.preventDefault();
          void editor.commit();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          editor.cancel();
        }
      }}
    />
  );
});

ProjectionCellEditorInput.displayName = 'ProjectionCellEditorInput';

export default ProjectionCellEditorInput;

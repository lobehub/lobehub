'use client';

import { Button, TextArea } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { memo } from 'react';

import type { ProjectionTableCell } from './model';
import type { ProjectionCellEditorController } from './useProjectionCellEditor';

const styles = createStaticStyles(({ css }) => ({
  actions: css`
    display: flex;
    flex-shrink: 0;
    gap: 6px;
    align-items: center;
  `,
  editor: css`
    display: flex;
    flex-direction: column;
    gap: 8px;

    padding-block: 10px 12px;
    padding-inline: 12px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    background: ${cssVar.colorFillQuaternary};
  `,
  footer: css`
    display: flex;
    gap: 8px;
    align-items: flex-start;
    justify-content: space-between;
  `,
  message: css`
    flex: 1;

    padding-block: 3px;

    font-size: 10px;
    line-height: 1.35;
    color: ${cssVar.colorTextQuaternary};
  `,
  messageError: css`
    color: ${cssVar.colorError};
  `,
  textarea: css`
    min-height: 190px;
    max-height: 320px;
    border-radius: 0;

    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeSM};
    line-height: 1.5;

    background: ${cssVar.colorBgContainer};
    box-shadow: inset 2px 0 0 ${cssVar.colorPrimary};
  `,
  textareaError: css`
    box-shadow: inset 2px 0 0 ${cssVar.colorError};
  `,
}));

interface ProjectionObjectJsonEditorProps {
  cell: ProjectionTableCell;
  editor: ProjectionCellEditorController;
}

export const ProjectionObjectJsonEditor = memo<ProjectionObjectJsonEditorProps>(
  ({ cell, editor }) => (
    <div className={styles.editor} onClick={(event) => event.stopPropagation()}>
      <TextArea
        autoFocus
        resize
        aria-invalid={Boolean(editor.error)}
        aria-label={`Edit ${cell.column.label} as JSON`}
        className={cx(styles.textarea, editor.error ? styles.textareaError : undefined)}
        disabled={editor.isApplying}
        spellCheck={false}
        value={editor.draft}
        variant={'borderless'}
        onChange={(event) => editor.setDraft(event.target.value)}
        onDoubleClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Escape') {
            event.preventDefault();
            editor.cancel();
          } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void editor.commit();
          }
        }}
      />
      <div className={styles.footer}>
        <span className={cx(styles.message, editor.error ? styles.messageError : undefined)}>
          {editor.error ?? '⌘/Ctrl + Enter to apply · Esc to cancel'}
        </span>
        <div className={styles.actions}>
          <Button disabled={editor.isApplying} size={'small'} type={'text'} onClick={editor.cancel}>
            Cancel
          </Button>
          <Button
            loading={editor.isApplying}
            size={'small'}
            type={'primary'}
            onClick={() => void editor.commit()}
          >
            Apply
          </Button>
        </div>
      </div>
    </div>
  ),
);

ProjectionObjectJsonEditor.displayName = 'ProjectionObjectJsonEditor';

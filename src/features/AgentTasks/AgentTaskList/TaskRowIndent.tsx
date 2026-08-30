import { Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import type { ReactNode } from 'react';

/** Indent added per nesting level, in px. */
const INDENT_STEP = 20;

const styles = createStaticStyles(({ css, cssVar }) => {
  return {
    // Elbow drawn from the row's top edge down to its vertical centre, so a
    // child reads as hanging off the row above it rather than off the group.
    connector: css`
      position: relative;

      flex: none;
      align-self: stretch;

      inline-size: 12px;
      margin-inline-end: 4px;

      &::before {
        content: '';

        position: absolute;
        inset-block: 0 50%;
        inset-inline-start: 0;

        inline-size: 8px;
        border-block-end: 1px solid ${cssVar.colorBorder};
        border-inline-start: 1px solid ${cssVar.colorBorder};
        border-end-start-radius: 4px;
      }
    `,
    muted: css`
      opacity: 0.5;
    `,
  };
});

interface TaskRowIndentProps {
  children: ReactNode;
  /** Nesting level of the row; 0 renders the task untouched. */
  depth: number;
  /**
   * Dims the row to mark it as context only — the task is shown to place a
   * nested child, not because it belongs to this group.
   */
  muted?: boolean;
}

const TaskRowIndent = ({ children, depth, muted }: TaskRowIndentProps) => {
  if (depth <= 0 && !muted) return <>{children}</>;

  return (
    <Flexbox
      horizontal
      align={'stretch'}
      className={muted ? styles.muted : undefined}
      style={depth > 0 ? { paddingInlineStart: depth * INDENT_STEP } : undefined}
    >
      {depth > 0 && <div className={styles.connector} />}
      <Flexbox flex={1} style={{ minWidth: 0 }}>
        {children}
      </Flexbox>
    </Flexbox>
  );
};

export default TaskRowIndent;

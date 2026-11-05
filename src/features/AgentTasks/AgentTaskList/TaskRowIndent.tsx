import { Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';

/** Indent added per nesting level, in px. */
const INDENT_STEP = 20;

const styles = stylex.create({
  connector: {
    'position': 'relative',
    'flex': 'none',
    'alignSelf': 'stretch',
    'inlineSize': '12px',
    'marginInlineEnd': '4px',
    '::before': {
      content: "''",
      position: 'absolute',
      insetBlockStart: '0',
      insetBlockEnd: '50%',
      insetInlineStart: '0',
      inlineSize: '8px',
      borderBlockEndWidth: '1px',
      borderBlockEndStyle: 'solid',
      borderBlockEndColor: cssVar.colorBorder,
      borderInlineStartWidth: '1px',
      borderInlineStartStyle: 'solid',
      borderInlineStartColor: cssVar.colorBorder,
      borderEndStartRadius: '4px',
    },
  },
  muted: { opacity: 0.5 },
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
      className={stylex.props(muted ? styles.muted : undefined).className}
      style={depth > 0 ? { paddingInlineStart: depth * INDENT_STEP } : undefined}
    >
      {depth > 0 && <div {...stylex.props(styles.connector)} />}
      <Flexbox flex={1} style={{ minWidth: 0 }}>
        {children}
      </Flexbox>
    </Flexbox>
  );
};

export default TaskRowIndent;

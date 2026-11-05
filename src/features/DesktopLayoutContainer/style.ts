import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

export const styles = stylex.create({
  // Inner container
  innerContainer: {
    position: 'relative',
    overflow: 'hidden',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: `var(--container-border-color, ${cssVar.colorBorder})`,
    borderRadius: `var(--container-border-radius, ${cssVar.borderRadius})`,
    borderEndEndRadius: `var(
      --container-border-bottom-right-radius,
      var(--container-border-radius, ${cssVar.borderRadius})
    )`,
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },

  // `flush`: the rail wrap owns border, radius and spacing.
  innerFlush: {
    borderStyle: 'none',
    borderColor: 'currentcolor',
    borderRadius: 0,
    borderEndEndRadius: 0,
  },

  // Outer container
  outerContainer: {
    position: 'relative',
    overflow: 'hidden',
    paddingBlockStart: 'var(--container-padding-top, 8px)',
    paddingInlineStart: 'var(--container-padding-left, 8px)',
    backgroundColor: cssVar.colorBgLayout,
    backgroundImage: 'none',
  },

  outerContainerDesktop: { backgroundColor: 'transparent' },

  outerFlush: {
    minWidth: 0,
    paddingBlockStart: 0,
    paddingBlockEnd: 0,
    paddingInlineStart: 0,
    paddingInlineEnd: 0,
    backgroundColor: 'transparent',
    backgroundImage: 'none',
  },
});

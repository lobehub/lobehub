import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import { media } from '@lobehub/ui/stylex/media.stylex';
import * as stylex from '@stylexjs/stylex';

const styles = stylex.create({
  grid: {
    display: 'grid',
    gridTemplateColumns: { default: 'repeat(2, 1fr)', [media.sm]: '1fr' },
    gap: '12px',
    paddingBlockEnd: '16px',
    paddingInline: '16px',
  },
  virtuosoItem: {
    width: { default: 'calc(50% - 6px)', [media.sm]: '100%' },
  },
  virtuosoList: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '12px',
    paddingBlockEnd: '16px',
    paddingInline: '16px',
  },
  container: {
    position: 'relative',
    overflow: 'hidden',
    flex: '1',
    minWidth: '0',
  },
  description: {
    overflow: 'hidden',
    fontSize: '12px',
    color: cssVar.colorTextSecondary,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  title: {
    overflow: 'hidden',
    fontSize: '14px',
    fontWeight: 500,
    color: cssVar.colorText,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
});

// Consumers hand these to `className` props of other components, so they are exported as
// compiled class names.
export const gridStyles = {
  grid: stylex.props(styles.grid).className,
};

export const virtuosoGridStyles = {
  item: stylex.props(styles.virtuosoItem).className,
  list: stylex.props(styles.virtuosoList).className,
};

export const itemStyles = {
  container: stylex.props(styles.container).className,
  description: stylex.props(styles.description).className,
  title: stylex.props(styles.title).className,
};

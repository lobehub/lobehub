import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import { media } from '@lobehub/ui/stylex/media.stylex';
import * as stylex from '@stylexjs/stylex';

const styles = stylex.create({
  item: {
    width: { default: 'calc(50% - 6px)', [media.sm]: '100%' },
  },
  list: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '12px',
    paddingBlockEnd: '16px',
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
export const agentListStyles = {
  item: stylex.props(styles.item).className,
  list: stylex.props(styles.list).className,
};

export const itemStyles = {
  container: stylex.props(styles.container).className,
  description: stylex.props(styles.description).className,
  title: stylex.props(styles.title).className,
};

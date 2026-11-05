import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

const BREADCRUMB_SCOPE_CLASS = 'lobe-breadcrumb-30cde0ed-breadcrumb';

export const breadcrumbStyles = stylex.create({
  crumb: {
    overflow: 'hidden',
    display: 'flex',
    alignItems: 'center',
    minWidth: 0,
    paddingBlock: '2px',
    paddingInline: '6px',
    borderRadius: cssVar.borderRadius,
  },
  item: {
    overflow: 'hidden',
    display: 'flex',
    flexShrink: 1,
    alignItems: 'center',
    minWidth: 0,
  },
  root: {
    overflow: 'hidden',
    minWidth: 0,
  },
  separator: {
    overflow: 'visible',
    flexShrink: 0,
    minWidth: 'auto',
    marginInline: '2px',
  },
});

export const breadcrumbClassNames = {
  item: stylex.props(breadcrumbStyles.item).className,
  separator: stylex.props(breadcrumbStyles.separator).className,
};

export const breadcrumbRootClassName = [
  BREADCRUMB_SCOPE_CLASS,
  stylex.props(breadcrumbStyles.root).className,
].join(' ');

export const breadcrumbCrumbClassName = stylex.props(breadcrumbStyles.crumb).className;

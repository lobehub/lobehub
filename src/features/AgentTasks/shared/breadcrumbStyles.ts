// oxlint-disable-next-line stylex-migration/no-emotion-styles -- needs lobe-ui slot: Breadcrumb.list
import { createStaticStyles, cx } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

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

const fallback = createStaticStyles(({ css }) => ({
  breadcrumb: css`
    ol {
      flex-wrap: nowrap;
      align-items: center;
      min-width: 0;
    }
  `,
}));

export const breadcrumbClassNames = {
  item: stylex.props(breadcrumbStyles.item).className,
  separator: stylex.props(breadcrumbStyles.separator).className,
};

export const breadcrumbRootClassName = cx(
  stylex.props(breadcrumbStyles.root).className,
  fallback.breadcrumb,
);

export const breadcrumbCrumbClassName = stylex.props(breadcrumbStyles.crumb).className;

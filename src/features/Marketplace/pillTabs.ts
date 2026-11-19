import { type TabsProps } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

/**
 * The Codex view tabs (`Public` / `Personal`): a bare row of labels where only
 * the active one sits on a filled pill. `@lobehub/ui` `Tabs variant="rounded"`
 * draws a segmented track with a raised chip instead, so these slots drop the
 * track and repaint the chip. No radius token reaches a pill.
 */
const styles = stylex.create({
  indicator: {
    borderRadius: '999px',
    backgroundColor: cssVar.colorFillSecondary,
    boxShadow: 'none',
  },
  list: { padding: 0, backgroundColor: 'transparent' },
  tab: {
    borderRadius: '999px',
    color: {
      'default': cssVar.colorTextSecondary,
      ':hover': cssVar.colorText,
      ':is([aria-selected="true"])': cssVar.colorText,
    },
  },
});

/** Pass with `variant="rounded"` to any Marketplace view-tab row. */
export const pillTabClassNames: NonNullable<TabsProps['classNames']> = {
  indicator: stylex.props(styles.indicator).className,
  list: stylex.props(styles.list).className,
  tab: stylex.props(styles.tab).className,
};

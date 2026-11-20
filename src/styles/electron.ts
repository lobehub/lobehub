import { cx } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';

const styles = stylex.create({
  draggable: { WebkitAppRegion: 'drag' },
  nodrag: { WebkitAppRegion: 'no-drag' },
});

/**
 * Hook class for the drag region, keyed by `global.css` to scope the `button` opt-out.
 * StyleX cannot express a descendant selector, and the opt-out must not be page-wide:
 * Chromium reports every app-region box's *unclipped* border box in layout order and the
 * later rect wins, so a global `button { -webkit-app-region: no-drag }` turned every
 * button in the page into a hole in the titlebar — including buttons in the content
 * below that scroll up under it, which come after the titlebar in layout order.
 */
const DRAG_REGION_CLASS = 'lobe-drag-region';

export const draggable = cx(stylex.props(styles.draggable).className, DRAG_REGION_CLASS);

export const nodrag = stylex.props(styles.nodrag).className ?? '';

export const electronStylish = {
  draggable,
  nodrag,
};

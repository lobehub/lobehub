import { type InterfaceDensity } from '@lobechat/types';
import { type AccordionStyles, type ActionIconSize } from '@lobehub/ui';

/**
 * A step row (a tool call, a reasoning block, a workflow fold) is one line in a
 * dense list, not a card.
 *
 * Compact density leaves it a couple of pixels of padding, which is thinner
 * than the Accordion header's hover fill: the fill then reads as a grey block
 * appearing around a line of text rather than as a row highlight, so compact
 * drops it — the same way `ProcessFold` and the workflow summary do.
 *
 * Without the fill the row is just text, and text belongs on the prose edge:
 * compact also drops its inline padding (the package's `padding-inline` on the
 * trigger and its `padding-inline-end` reserved for the inline action buttons)
 * so the row starts and ends on the same column as the answer above it.
 *
 * `action`'s `padding-block` is part of the same trade: 4px alone is taller
 * than the compact row, so together with `STEP_ACTION_ICON_SIZE` the row keeps
 * its height when its hover actions mount.
 */
const COMPACT_STEP_ROW: AccordionStyles = {
  action: { paddingBlock: 0, paddingInlineEnd: 0 },
  header: { background: 'transparent' },
};

export const STEP_TRIGGER_STYLES = {
  compact: {
    ...COMPACT_STEP_ROW,
    trigger: { fontSize: 12, paddingBlock: 1, paddingInline: 0 },
  },
  loose: { trigger: { paddingBlock: 4, paddingInline: 4 } },
} satisfies Record<InterfaceDensity, AccordionStyles>;

/**
 * Size of a step row's action buttons. They sit inside the row, so compact
 * keeps them under its height (~20px) instead of the 24px the `small` preset
 * adds — otherwise the row grows the first time the pointer reaches it, because
 * the buttons only mount then.
 */
export const STEP_ACTION_ICON_SIZE = {
  compact: { blockSize: 18, borderRadius: 4, size: 12 },
  loose: 'small',
} satisfies Record<InterfaceDensity, ActionIconSize>;

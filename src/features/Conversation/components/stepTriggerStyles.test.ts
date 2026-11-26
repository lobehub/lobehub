import { describe, expect, it } from 'vitest';

import { STEP_ACTION_ICON_SIZE, STEP_TRIGGER_STYLES } from './stepTriggerStyles';

/**
 * These are the invariants behind a step row's hover behaviour and its
 * alignment, not the stylesheet. In compact the row is a couple of pixels of
 * padding tall, so an opaque header fill reads as a block appearing around a
 * line of text, an action button taller than the row rewrites the row's height
 * the first time the pointer reaches it (the buttons only mount then), and any
 * inline padding shifts the row off the prose column it sits under.
 */
describe('compact step rows', () => {
  /** The row is the trigger's own line (12px text at 1.6) plus 1px block padding either side. */
  const ROW_HEIGHT = 12 * 1.6 + 2;

  it('paints no hover fill behind the row', () => {
    expect(STEP_TRIGGER_STYLES.compact.header?.background).toBe('transparent');
  });

  it('starts and ends on the prose column', () => {
    expect(STEP_TRIGGER_STYLES.compact.trigger?.paddingInline).toBe(0);
    expect(STEP_TRIGGER_STYLES.compact.action?.paddingInlineEnd).toBe(0);
  });

  it('does not reserve the package padding that would outgrow the row', () => {
    // `@lobehub/ui` pads `.accordion-action` by 4px, which alone exceeds the row.
    expect(STEP_TRIGGER_STYLES.compact.action?.paddingBlock).toBe(0);
  });

  it('keeps the hover action buttons inside the row height', () => {
    const { blockSize } = STEP_ACTION_ICON_SIZE.compact;

    expect(typeof blockSize).toBe('number');
    expect(blockSize).toBeLessThan(ROW_HEIGHT);
  });
});

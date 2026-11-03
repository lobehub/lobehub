import { describe, expect, it } from 'vitest';

import { createDragSelectionTracker } from './useDragSelection';

describe('createDragSelectionTracker', () => {
  it('updates the drag rectangle immediately after start and move', () => {
    const tracker = createDragSelectionTracker();

    tracker.start(24, 36);
    tracker.move(120, 168);

    expect(tracker.isDragging).toBe(true);
    expect(tracker.dragRect).toEqual({
      height: 132,
      width: 96,
      x: 24,
      y: 36,
    });
  });
});

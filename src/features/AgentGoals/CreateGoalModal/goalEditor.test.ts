import { describe, expect, it } from 'vitest';

import { GOAL_INSTRUCTION_EDITOR_PROPS } from './goalEditor';

describe('GOAL_INSTRUCTION_EDITOR_PROPS', () => {
  // T-3387: a video uploaded into the goal description was the last block, so
  // there was no line under it to keep typing on.
  it('opens a line after block attachments such as videos', () => {
    expect(GOAL_INSTRUCTION_EDITOR_PROPS.blockImageCaretGuard).toBe(true);
  });

  it('keeps the formatting toolbar off in the compact modal editors', () => {
    expect(GOAL_INSTRUCTION_EDITOR_PROPS.floatingToolbar).toBe(false);
  });
});

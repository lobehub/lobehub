import { beforeEach, describe, expect, it } from 'vitest';

import {
  peekLastUndoEntry,
  pushUndoEntry,
  resetUndoStack,
  takeUndoEntry,
  TASK_BATCH_UNDO_LIMIT,
} from './stack';

beforeEach(() => resetUndoStack());

describe('task batch undo stack', () => {
  it('keeps the most recent batches, newest last', () => {
    for (let i = 0; i < TASK_BATCH_UNDO_LIMIT + 2; i++)
      pushUndoEntry({ kind: 'restore', taskIds: [`t${i}`] });
    const last = peekLastUndoEntry();
    expect(last).toMatchObject({ taskIds: [`t${TASK_BATCH_UNDO_LIMIT + 1}`] });
  });

  it('hands an entry out only once', () => {
    const entry = pushUndoEntry({ kind: 'restore', taskIds: ['a'] });
    expect(takeUndoEntry(entry.id)).toBe(true);
    expect(takeUndoEntry(entry.id)).toBe(false);
    expect(peekLastUndoEntry()).toBeUndefined();
  });
});

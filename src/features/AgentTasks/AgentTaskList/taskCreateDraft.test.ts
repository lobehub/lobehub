/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { persistTaskCreateDraft, readTaskCreateDraft } from './taskCreateDraft';

const KEY = 'lobehub:task-create-draft:workspace-1:all';

describe('taskCreateDraft', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('writes a draft that holds text', () => {
    expect(persistTaskCreateDraft(KEY, { markdown: 'Write a plan', priority: 2 }, false)).toBe(
      true,
    );

    expect(readTaskCreateDraft(KEY)).toEqual({ markdown: 'Write a plan', priority: 2 });
  });

  it('discards the saved draft once the user empties a composer that held text', () => {
    // Deleting everything used to leave the last text on disk, so it came back
    // on every reload or tab switch and could never be cleared.
    persistTaskCreateDraft(KEY, { markdown: 'Write a plan' }, false);

    expect(persistTaskCreateDraft(KEY, { markdown: '' }, true)).toBe(false);
    expect(readTaskCreateDraft(KEY)).toBeNull();
  });

  it('keeps the saved draft on an empty read before the composer has held text', () => {
    // Right after a restore the editor can still read empty until `setDocument`
    // lands; that read must not wipe the draft being restored.
    localStorage.setItem(KEY, JSON.stringify({ markdown: 'Write a plan' }));

    expect(persistTaskCreateDraft(KEY, { markdown: '' }, false)).toBe(false);
    expect(readTaskCreateDraft(KEY)).toEqual({ markdown: 'Write a plan' });
  });

  it('reads a malformed draft as no draft', () => {
    localStorage.setItem(KEY, '{not json');

    expect(readTaskCreateDraft(KEY)).toBeNull();
  });
});

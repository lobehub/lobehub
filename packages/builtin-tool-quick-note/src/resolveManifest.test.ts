import { describe, expect, it } from 'vitest';

import { QuickNoteManifest } from './manifest';
import { resolveQuickNoteManifest } from './resolveManifest';

describe('resolveQuickNoteManifest', () => {
  it('exposes the submit tool inside a Quick Note run', () => {
    expect(resolveQuickNoteManifest({ scope: 'quick_note' })).toBe(QuickNoteManifest);
  });

  it.each([{}, { scope: 'main' }, { scope: 'task' }, { isSubAgent: true, scope: 'sub_agent' }])(
    'hides the submit tool outside Quick Note (%o)',
    (context) => {
      expect(resolveQuickNoteManifest(context)).toBeNull();
    },
  );
});

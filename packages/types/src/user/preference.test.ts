import { describe, expect, it } from 'vitest';

import { UserPreferenceSchema } from './preference';

describe('UserPreferenceSchema', () => {
  // `user.updatePreference` validates its input with this schema, and zod
  // strips unknown keys rather than rejecting them. A field that exists on the
  // TypeScript interface but is missing here therefore fails silently: the
  // client patches its store optimistically, the write "succeeds", and the
  // value is gone on the next load. Both sidebar preferences are asserted so
  // the pair cannot drift apart again.
  it.each([['sidebarHiddenAgentIds'], ['sidebarHiddenGroupIds']])(
    'preserves %s instead of stripping it',
    (key) => {
      const parsed = UserPreferenceSchema.parse({ telemetry: null, [key]: ['id-1', 'id-2'] });

      expect(parsed).toMatchObject({ [key]: ['id-1', 'id-2'] });
    },
  );

  // The rail order is replaced as a whole on every write, so it must survive intact.
  it('preserves the workspace rail order instead of stripping it', () => {
    const parsed = UserPreferenceSchema.parse({
      telemetry: null,
      workspace: { order: ['ws-2', 'ws-1'] },
    });

    expect(parsed).toMatchObject({ workspace: { order: ['ws-2', 'ws-1'] } });
  });
});

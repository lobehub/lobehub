import { describe, expect, it } from 'vitest';

import type { SandboxEnvironment } from '@/store/sandbox';

import { hasEditedEnvironment, projectEnvironmentRows } from './projectEnvironmentRows';

const configured = (id: string, name = id): SandboxEnvironment => ({
  createdAt: '2026-10-01T00:00:00.000Z',
  creator: null,
  description: null,
  id,
  kind: 'code',
  name,
  userId: 'user-1',
  visibility: 'private',
  workspaceId: null,
});

describe('projectEnvironmentRows', () => {
  it("shows a linked environment as the configured row, in the project's order", () => {
    const result = projectEnvironmentRows(
      [{ id: 'b' }, { id: 'a' }],
      [configured('a', 'Renamed in settings'), configured('b'), configured('c')],
    );

    expect(result.configured.map((row) => row.id)).toEqual(['b', 'a']);
    // The configured row wins, so an edit made in settings shows here too.
    expect(result.configured[1].name).toBe('Renamed in settings');
    expect(result.unlisted).toEqual([]);
  });

  it('keeps a linked environment the configured list does not hold apart', () => {
    const result = projectEnvironmentRows(
      [{ id: 'a' }, { id: 'gone', name: 'Theirs' }],
      [configured('a')],
    );

    expect(result.configured.map((row) => row.id)).toEqual(['a']);
    expect(result.unlisted).toEqual([{ id: 'gone', name: 'Theirs' }]);
  });
});

describe('hasEditedEnvironment', () => {
  it('reports a rename or a visibility change of a row listed both times', () => {
    expect(
      hasEditedEnvironment([configured('a', 'Old: name')], [configured('a', 'New: name')]),
    ).toBe(true);
    expect(
      hasEditedEnvironment([configured('a')], [{ ...configured('a'), visibility: 'public' }]),
    ).toBe(true);
  });

  it('ignores linking, unlinking and unchanged rows', () => {
    expect(hasEditedEnvironment([configured('a')], [configured('a'), configured('b')])).toBe(false);
    expect(hasEditedEnvironment([configured('a'), configured('b')], [configured('a')])).toBe(false);
    expect(hasEditedEnvironment([configured('a')], [configured('a')])).toBe(false);
  });
});

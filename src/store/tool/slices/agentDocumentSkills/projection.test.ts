import { describe, expect, it } from 'vitest';

import { mapDocsToSkills } from './projection';

const doc = (overrides: Record<string, unknown> = {}) =>
  ({
    description: null,
    documentId: 'doc-1',
    filename: 'demo',
    isSkillBundle: true,
    title: 'Demo',
    ...overrides,
  }) as any;

describe('mapDocsToSkills', () => {
  it('keeps only the skill bundles', () => {
    const mapped = mapDocsToSkills([
      doc({ documentId: 'd1', filename: 'one', isSkillBundle: true }),
      doc({ documentId: 'd2', filename: 'clip', isSkillBundle: false }),
    ]);

    expect(mapped.map((s) => s.name)).toEqual(['one']);
  });

  it('builds the identifier from the filename and keeps title / description', () => {
    const mapped = mapDocsToSkills([
      doc({
        description: 'Does a thing',
        documentId: 'd9',
        filename: 'release-notes',
        title: 'Release notes',
      }),
    ]);

    expect(mapped).toEqual([
      {
        description: 'Does a thing',
        documentId: 'd9',
        identifier: 'agent-skills:release-notes',
        name: 'release-notes',
        title: 'Release notes',
      },
    ]);
  });

  it('omits empty description / title so the UI falls back to the filename', () => {
    const [skill] = mapDocsToSkills([doc({ description: null, filename: 'bare', title: '' })]);

    expect(skill.description).toBeUndefined();
    expect(skill.title).toBeUndefined();
    expect(skill.name).toBe('bare');
  });

  it('returns an empty registry for an empty or all-non-skill list', () => {
    expect(mapDocsToSkills([])).toEqual([]);
    expect(mapDocsToSkills([doc({ isSkillBundle: false })])).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';

import {
  describeUnresolvedTaskLabels,
  formatTaskLabelPath,
  invertTaskLabelChange,
  resolveTaskLabelRefs,
} from './label';

const registry = [
  { id: 'g-type', isGroup: true, name: 'Type', parentId: null },
  { id: 'bug', isGroup: false, name: 'Bug', parentId: 'g-type' },
  { id: 'feature', isGroup: false, name: 'Feature', parentId: 'g-type' },
  { id: 'fe', isGroup: false, name: 'Frontend', parentId: null },
  { id: 'uiux', isGroup: false, name: 'UI/UX', parentId: null },
];

describe('resolveTaskLabelRefs', () => {
  it('resolves bare names and group paths case-insensitively, de-duplicated', () => {
    expect(resolveTaskLabelRefs(registry, ['bug', 'Type/Feature', ' FRONTEND ', 'Bug'])).toEqual({
      ids: ['bug', 'feature', 'fe'],
      unresolved: [],
    });
  });

  it('prefers a label whose whole name contains the separator', () => {
    expect(resolveTaskLabelRefs(registry, ['ui/ux']).ids).toEqual(['uiux']);
  });

  it('rejects a path naming the wrong group', () => {
    const result = resolveTaskLabelRefs(registry, ['Other/Bug']);
    expect(result.ids).toEqual([]);
    expect(result.unresolved[0]).toMatchObject({ reason: 'notFound' });
    expect(result.unresolved[0].suggestions).toContain('Type/Bug');
  });

  it('never resolves a group, and lists its labels instead', () => {
    expect(resolveTaskLabelRefs(registry, ['type']).unresolved).toEqual([
      { input: 'type', reason: 'group', suggestions: ['Type/Bug', 'Type/Feature'] },
    ]);
  });

  it('suggests close names for a typo', () => {
    const { unresolved } = resolveTaskLabelRefs(registry, ['Frontnd']);
    expect(unresolved[0].suggestions[0]).toBe('Frontend');
    expect(describeUnresolvedTaskLabels(unresolved)).toBe(
      'Label "Frontnd" not found (did you mean: Frontend?)',
    );
  });
});

describe('formatTaskLabelPath', () => {
  it('prefixes the group name', () => {
    expect(formatTaskLabelPath(registry[1], registry)).toBe('Type/Bug');
    expect(formatTaskLabelPath(registry[3], registry)).toBe('Frontend');
  });
});

describe('invertTaskLabelChange', () => {
  it('undoes only the applied delta, including implicit group swaps', () => {
    // before: Bug (Type) + Frontend; add Feature (swaps Bug), remove Frontend
    const undo = invertTaskLabelChange(
      ['bug', 'fe'],
      { add: ['feat'], remove: ['fe'] },
      ['feat', 'other'], // `other` was added concurrently by someone else
    );

    expect(undo).toEqual({ add: ['bug', 'fe'], remove: ['feat'] });
  });

  it('does not remove a label that was already there', () => {
    expect(invertTaskLabelChange(['bug'], { add: ['bug'] }, ['bug'])).toEqual({
      add: [],
      remove: [],
    });
  });
});

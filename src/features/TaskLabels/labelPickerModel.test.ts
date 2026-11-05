import type { TaskLabel } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  buildTaskLabelPickerSections,
  canCreateTaskLabel,
  pickedLabelIds,
  resolveTaskLabelRefs,
  toggleTaskLabelSelection,
  toTaskLabelRef,
} from './labelPickerModel';

const label = (id: string, name: string, extra: Partial<TaskLabel> = {}): TaskLabel => ({
  color: '#000',
  id,
  isGroup: false,
  name,
  parentId: null,
  sortOrder: 0,
  ...extra,
});

const registry: TaskLabel[] = [
  label('fe', 'Frontend'),
  label('type', 'Type', { isGroup: true }),
  label('bug', 'Bug', { parentId: 'type' }),
  label('feature', 'Feature', { parentId: 'type' }),
  label('empty', 'Empty group', { isGroup: true }),
];

describe('buildTaskLabelPickerSections', () => {
  it('lists loose labels first, then non-empty groups', () => {
    const sections = buildTaskLabelPickerSections(registry);
    expect(sections.map((s) => s.group?.id)).toEqual([undefined, 'type']);
    expect(sections[1].labels.map((l) => l.id)).toEqual(['bug', 'feature']);
  });

  it('filters by label or group name', () => {
    expect(
      buildTaskLabelPickerSections(registry, 'bu').flatMap((s) => s.labels.map((l) => l.id)),
    ).toEqual(['bug']);
    expect(
      buildTaskLabelPickerSections(registry, 'type').flatMap((s) => s.labels.map((l) => l.id)),
    ).toEqual(['bug', 'feature']);
  });
});

describe('toggleTaskLabelSelection', () => {
  it('adds, removes, and swaps within a group', () => {
    const [fe, , bug, feature] = registry;
    let selected = toggleTaskLabelSelection([], fe);
    selected = toggleTaskLabelSelection(selected, bug);
    expect(selected.map((l) => l.id)).toEqual(['fe', 'bug']);

    selected = toggleTaskLabelSelection(selected, feature);
    expect(selected.map((l) => l.id)).toEqual(['fe', 'feature']);

    selected = toggleTaskLabelSelection(selected, fe);
    expect(selected).toEqual([toTaskLabelRef(feature)]);
  });
});

describe('canCreateTaskLabel', () => {
  it('needs a non-empty name not already taken', () => {
    expect(canCreateTaskLabel(registry, ' ')).toBe(false);
    expect(canCreateTaskLabel(registry, 'bug')).toBe(false);
    expect(canCreateTaskLabel(registry, 'Backend')).toBe(true);
  });
});

describe('resolveTaskLabelRefs', () => {
  it('keeps id order, drops unknown ids and groups', () => {
    const registry = [
      label('g', 'Type', { isGroup: true }),
      label('bug', 'Bug', { parentId: 'g' }),
      label('fe', 'Frontend'),
    ];

    expect(resolveTaskLabelRefs(registry, ['fe', 'gone', 'g', 'bug']).map((l) => l.id)).toEqual([
      'fe',
      'bug',
    ]);
    expect(resolveTaskLabelRefs(registry, undefined)).toEqual([]);
  });
});

describe('pickedLabelIds', () => {
  it('prefers picked labels, falls back to pending ids, else omits the key', () => {
    const bug = { color: null, id: 'bug', name: 'Bug', parentId: null };
    expect(pickedLabelIds([bug], ['fe'])).toEqual({ labelIds: ['bug'] });
    expect(pickedLabelIds([], ['fe'])).toEqual({ labelIds: ['fe'] });
    expect(pickedLabelIds([], undefined)).toEqual({});
  });
});

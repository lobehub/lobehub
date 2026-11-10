import type { TaskLabelWithUsage } from '@lobechat/types';
import { beforeEach, describe, expect, it } from 'vitest';

import { useTaskStore } from '@/store/task';
import type { TaskGroupItem, TaskListItem } from '@/store/task/slices/list/initialState';

import {
  buildKanbanColumns,
  getKanbanCreateTaskModalProps,
  getKanbanLabelPatch,
  getTaskGroupCreateDefaults,
  getTaskSubGroupCreateDefaults,
  normalizeKanbanGroupBy,
} from './kanbanBoardModel';
import {
  getTaskLabelGroupId,
  groupTaskItems,
  normalizeTaskListViewOptions,
  toTaskLabelGroupBy,
} from './listViewOptions';

const registryEntry = (
  id: string,
  name: string,
  extra: Partial<TaskLabelWithUsage> = {},
): TaskLabelWithUsage => ({
  color: '#111111',
  id,
  isGroup: false,
  name,
  parentId: null,
  sortOrder: 0,
  usageCount: 0,
  ...extra,
});

const registry = [
  registryEntry('fe', 'Frontend'),
  registryEntry('type', 'Type', { isGroup: true }),
  registryEntry('bug', 'Bug', { color: '#EB5757', parentId: 'type' }),
  registryEntry('feature', 'Feature', { parentId: 'type' }),
];

const groupBy = toTaskLabelGroupBy('type');

const task = (identifier: string, labels: TaskListItem['labels']): TaskListItem =>
  ({ id: identifier, identifier, labels, status: 'backlog' }) as unknown as TaskListItem;

beforeEach(() => {
  useTaskStore.setState({ taskLabels: registry, taskLabelsInit: true });
});

describe('label group-by encoding', () => {
  it('round-trips and survives view-option normalization', () => {
    expect(getTaskLabelGroupId(groupBy)).toBe('type');
    expect(normalizeKanbanGroupBy(groupBy)).toBe(groupBy);
    expect(normalizeTaskListViewOptions({ groupBy }).groupBy).toBe(groupBy);
    expect(normalizeTaskListViewOptions({ groupBy: 'label:' as never }).groupBy).toBe('status');
  });
});

describe('buildKanbanColumns for a label group', () => {
  it('names columns from the registry and keeps "no label" last', () => {
    const groups = [
      { key: 'label:none', labelId: null, tasks: [], total: 0 },
      { key: 'label:feature', labelId: 'feature', tasks: [], total: 0 },
      { key: 'label:bug', labelId: 'bug', tasks: [], total: 0 },
    ] as unknown as TaskGroupItem[];

    const columns = buildKanbanColumns(groups, groupBy);

    expect(columns.map((column) => column.key)).toEqual([
      'label:bug',
      'label:feature',
      'label:none',
    ]);
    expect(columns[0].groupMeta).toMatchObject({ label: 'Bug', labelColor: '#EB5757' });
    expect(columns.every((column) => column.droppable)).toBe(true);
  });
});

describe('getKanbanLabelPatch', () => {
  const columns = buildKanbanColumns(
    [
      { key: 'label:bug', labelId: 'bug', tasks: [], total: 0 },
      { key: 'label:feature', labelId: 'feature', tasks: [], total: 0 },
      { key: 'label:none', labelId: null, tasks: [], total: 0 },
    ] as unknown as TaskGroupItem[],
    groupBy,
  );
  const [bugColumn, featureColumn, noneColumn] = columns;
  const fe = { color: '#111111', id: 'fe', name: 'Frontend', parentId: null };
  const bug = { color: '#EB5757', id: 'bug', name: 'Bug', parentId: 'type' };

  it('swaps the group label and keeps the others', () => {
    const patch = getKanbanLabelPatch(task('T-1', [fe, bug]), groupBy, featureColumn);
    expect(patch?.labels.map((label) => label.id)).toEqual(['fe', 'feature']);
  });

  it('drops the group label on the "no label" column', () => {
    expect(getKanbanLabelPatch(task('T-1', [fe, bug]), groupBy, noneColumn)?.labels).toEqual([fe]);
  });

  it('is a no-op on the current column', () => {
    expect(getKanbanLabelPatch(task('T-1', [bug]), groupBy, bugColumn)).toBeUndefined();
    expect(getKanbanLabelPatch(task('T-2', []), groupBy, noneColumn)).toBeUndefined();
  });
});

describe('groupTaskItems by label group', () => {
  it('buckets list rows by their label in the group', () => {
    const bug = { id: 'bug', name: 'Bug', parentId: 'type' };
    const feature = { id: 'feature', name: 'Feature', parentId: 'type' };
    const grouped = groupTaskItems(
      [task('T-1', [feature]), task('T-2', []), task('T-3', [bug]), task('T-4', [bug])],
      groupBy,
    );

    expect(
      grouped.map(([meta, items]) => [meta.key, items.map((item) => item.identifier)]),
    ).toEqual([
      ['label:bug', ['T-3', 'T-4']],
      ['label:feature', ['T-1']],
      ['label:none', ['T-2']],
    ]);
  });
});

describe('label column create entry', () => {
  it('pins the column label on the create modal, and none for "No label"', () => {
    const groupBy = toTaskLabelGroupBy('g');
    const bug = getTaskGroupCreateDefaults({
      groupBy,
      key: 'label:bug',
      label: 'Bug',
      labelId: 'bug',
    });
    const none = getTaskGroupCreateDefaults({
      groupBy,
      key: 'label:none',
      label: '-',
      labelId: null,
    });

    expect(bug).toEqual({ labelIds: ['bug'] });
    expect(none).toEqual({});
    expect(getKanbanCreateTaskModalProps(bug!, {}).defaultLabelIds).toEqual(['bug']);
    expect(getKanbanCreateTaskModalProps(none!, {}).defaultLabelIds).toBeUndefined();
  });

  it('pins both labels when grouped and sub-grouped by two label groups', () => {
    const nested = getTaskSubGroupCreateDefaults(
      { groupBy: toTaskLabelGroupBy('type'), key: 'label:bug', label: 'Bug', labelId: 'bug' },
      { groupBy: toTaskLabelGroupBy('area'), key: 'label:fe', label: 'FE', labelId: 'fe' },
    );

    expect(getKanbanCreateTaskModalProps(nested!, {}).defaultLabelIds).toEqual(['bug', 'fe']);
  });
});

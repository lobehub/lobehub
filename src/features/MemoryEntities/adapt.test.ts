import { describe, expect, it } from 'vitest';

import {
  fromActivityRow,
  fromContextRow,
  linkedEntityOf,
  mergeById,
  type RawContextItem,
  toEntity,
  uniqueById,
} from './adapt';

const row = (id: string, parent: string): RawContextItem => ({
  context: { currentStatus: 'ongoing', description: `${id} now`, id, title: id, type: 'project' },
  memory: { title: parent },
});

describe('uniqueById', () => {
  it('keeps one page per context when queryMemories returns it once per parent memory', () => {
    // A context whose userMemoryIds hold two live parents comes back twice from the join.
    const rows = [row('ctx-a', 'mem-1'), row('ctx-a', 'mem-2'), row('ctx-b', 'mem-3')];

    const entities = uniqueById(rows.map(toEntity));

    expect(entities.map((e) => e.id)).toEqual(['ctx-a', 'ctx-b']);
  });
});

describe('mergeById', () => {
  it('adds rows fetched later without duplicating loaded ones', () => {
    const loaded = [row('ctx-a', 'mem-1'), row('ctx-b', 'mem-2')].map(toEntity);
    const nextPage = [row('ctx-b', 'mem-2'), row('ctx-c', 'mem-4')].map(toEntity);

    expect(mergeById(loaded, nextPage).map((e) => e.id)).toEqual(['ctx-a', 'ctx-b', 'ctx-c']);
  });
});

describe('store rows', () => {
  it('reads a flattened context row from the memory store', () => {
    const entity = fromContextRow({
      currentStatus: 'on_hold',
      description: '等签证',
      id: 'ctx-trip',
      summary: 'Japan trip',
      tags: ['travel'],
      title: '日本旅行',
      type: 'trip',
      updatedAt: new Date('2026-10-01T00:00:00.000Z'),
    });

    expect(entity).toMatchObject({
      description: '等签证',
      id: 'ctx-trip',
      kind: 'event',
      status: 'dormant',
      summary: 'Japan trip',
      title: '日本旅行',
      updatedAt: '2026-10-01T00:00:00.000Z',
    });
  });

  it('keeps the associated names of an activity list row, which the timeline links by', () => {
    const activity = fromActivityRow({
      associatedObjects: [{ name: 'IELTS' }],
      associatedSubjects: [{ name: '陈老师' }],
      capturedAt: new Date('2026-09-01T00:00:00.000Z'),
      id: 'act-1',
      narrative: '模考 6.5',
      startsAt: null,
      status: 'planned',
      title: '雅思模考',
    });

    expect(activity.names.map((n) => n.name)).toEqual(['陈老师', 'IELTS']);
    expect(activity).toMatchObject({ planned: true, title: '雅思模考', whenIsExact: false });
  });
});

describe('linkedEntityOf', () => {
  it('reads the flattened row the memory detail replica keeps for a deep link', () => {
    const detail = { description: '等签证', id: 'ctx-old', title: '日本旅行', type: 'trip' };

    expect(linkedEntityOf(detail, 'ctx-old')).toMatchObject({ id: 'ctx-old', title: '日本旅行' });
    expect(linkedEntityOf(detail, 'ctx-other')).toBeUndefined();
    expect(linkedEntityOf(null, 'ctx-old')).toBeUndefined();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { groupPageRows } from './group';
import { buildPageTree } from './tree';

const NOW = new Date('2026-10-23T12:00:00');

const page = (
  id: string,
  {
    created,
    html,
    parentId,
    updated,
  }: {
    created?: string;
    html?: boolean;
    parentId?: string;
    updated: string;
  },
) => ({
  createdAt: new Date(created ?? updated),
  fileType: html ? 'custom/html' : 'custom/document',
  id,
  parentId,
  updatedAt: new Date(updated),
});

const summarize = (groups: ReturnType<typeof groupPageRows>) =>
  groups.map(({ id, rows }) => [id, rows.map(({ doc }) => doc.id)]);

describe('groupPageRows', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps every row in one group when ungrouped', () => {
    const rows = buildPageTree([page('a', { updated: '2026-10-23T09:00:00' })]);

    expect(summarize(groupPageRows(rows, { groupBy: 'none', sortBy: 'updatedAt' }))).toEqual([
      ['all', ['a']],
    ]);
  });

  it('returns no groups for an empty list', () => {
    expect(groupPageRows([], { groupBy: 'none', sortBy: 'updatedAt' })).toEqual([]);
  });

  it('puts pages before artifacts and keeps a sub-page under its parent', () => {
    const rows = buildPageTree([
      page('report', { html: true, updated: '2026-10-23T10:00:00' }),
      page('notes', { updated: '2026-10-23T09:00:00' }),
      page('notes-chart', { html: true, parentId: 'notes', updated: '2026-10-23T08:00:00' }),
    ]);

    expect(summarize(groupPageRows(rows, { groupBy: 'byType', sortBy: 'updatedAt' }))).toEqual([
      ['page', ['notes', 'notes-chart']],
      ['artifact', ['report']],
    ]);
  });

  it('buckets by the sorted date, newest bucket first', () => {
    const rows = buildPageTree([
      page('title-a', { created: '2026-10-23T09:00:00', updated: '2026-09-01T09:00:00' }),
      page('title-b', { created: '2026-10-22T09:00:00', updated: '2026-10-23T08:00:00' }),
    ]);

    expect(summarize(groupPageRows(rows, { groupBy: 'byTime', sortBy: 'title' }))).toEqual([
      ['today', ['title-b']],
      ['2026-09', ['title-a']],
    ]);
    expect(summarize(groupPageRows(rows, { groupBy: 'byTime', sortBy: 'createdAt' }))).toEqual([
      ['today', ['title-a']],
      ['yesterday', ['title-b']],
    ]);
  });
});

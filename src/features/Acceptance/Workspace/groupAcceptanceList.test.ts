import { describe, expect, it } from 'vitest';

import type { AcceptanceListItem } from '@/services/verify';

import {
  expandedAcceptanceGroupKeys,
  groupAcceptanceList,
  hasProjectAcceptanceGroups,
  nextCollapsedGroupKeys,
  normalizeAcceptanceGroupMode,
  shouldRenderAcceptanceGroups,
} from './groupAcceptanceList';

const item = (id: string, project: { id: string; name: string } | null): AcceptanceListItem =>
  ({ id, project }) as AcceptanceListItem;

const dated = (id: string, status: string, createdAt: string): AcceptanceListItem =>
  ({ createdAt: new Date(createdAt), id, project: null, status }) as unknown as AcceptanceListItem;

describe('groupAcceptanceList by project', () => {
  it('groups acceptances by project and keeps missing projects under ungrouped', () => {
    const groups = groupAcceptanceList([
      item('ungrouped-1', null),
      item('beta-1', { id: 'project-beta', name: 'Beta' }),
      item('alpha-1', { id: 'project-alpha', name: 'Alpha' }),
      item('beta-2', { id: 'project-beta', name: 'Beta' }),
      item('ungrouped-2', null),
    ]);

    expect(groups.map(({ key }) => key)).toEqual(['project-alpha', 'project-beta', 'ungrouped']);
    expect(groups[1].items.map(({ id }) => id)).toEqual(['beta-1', 'beta-2']);
    expect(groups[2].items.map(({ id }) => id)).toEqual(['ungrouped-1', 'ungrouped-2']);
    expect(groups[0].name).toBe('Alpha');
    expect(groups[2].labelKey).toBe('acceptance.workspace.groups.ungrouped');
  });

  it('does not require group chrome when every acceptance is ungrouped', () => {
    expect(
      hasProjectAcceptanceGroups(groupAcceptanceList([item('one', null), item('two', null)])),
    ).toBe(false);
    expect(
      hasProjectAcceptanceGroups(
        groupAcceptanceList([item('one', null), item('two', { id: 'project', name: 'Project' })]),
      ),
    ).toBe(true);
  });
});

describe('groupAcceptanceList by status', () => {
  const rows = [
    dated('accepted', 'accepted', '2026-08-30T00:00:00Z'),
    dated('verifying', 'verifying', '2026-08-30T00:00:00Z'),
    dated('delivered', 'delivered', '2026-08-30T00:00:00Z'),
    dated('rejected', 'rejected', '2026-08-30T00:00:00Z'),
    dated('closed', 'closed', '2026-08-30T00:00:00Z'),
    dated('repairing', 'repairing', '2026-08-30T00:00:00Z'),
  ];

  it('orders buckets by how the reviewer works down them, not by row order', () => {
    expect(groupAcceptanceList(rows, 'status').map(({ key }) => key)).toEqual([
      'running',
      'review',
      'rejected',
      'accepted',
      'closed',
    ]);
  });

  it('reads a repair round as still running, and a verdict as awaiting review', () => {
    const byKey = new Map(groupAcceptanceList(rows, 'status').map((g) => [g.key, g]));
    expect(byKey.get('running')!.items.map(({ id }) => id)).toEqual(['verifying', 'repairing']);
    expect(byKey.get('review')!.items.map(({ id }) => id)).toEqual(['delivered']);
  });

  it('drops buckets nothing landed in', () => {
    const groups = groupAcceptanceList([dated('a', 'accepted', '2026-08-30T00:00:00Z')], 'status');
    expect(groups.map(({ key }) => key)).toEqual(['accepted']);
  });
});

describe('groupAcceptanceList by time', () => {
  // 2026-08-30 12:00 local — the reference "now" for every case below.
  const now = new Date('2026-08-30T12:00:00').getTime();

  it('cuts on rolling spans, so early-in-the-week does not fall off a calendar edge', () => {
    const groups = groupAcceptanceList(
      [
        dated('today', 'delivered', '2026-08-30T01:00:00'),
        dated('yesterday', 'delivered', '2026-08-29T23:00:00'),
        dated('week', 'delivered', '2026-08-25T10:00:00'),
        dated('month', 'delivered', '2026-08-10T10:00:00'),
        dated('earlier', 'delivered', '2026-01-01T10:00:00'),
      ],
      'time',
      now,
    );

    expect(groups.map(({ key }) => key)).toEqual([
      'today',
      'yesterday',
      'week',
      'month',
      'earlier',
    ]);
    expect(groups.map(({ items }) => items.length)).toEqual([1, 1, 1, 1, 1]);
  });

  it('buckets on createdAt — the same key the feed pages on', () => {
    // A row created a month ago but touched seconds ago must stay where the
    // scroll will actually reach it, not jump into today and leave a gap.
    const stale = {
      createdAt: new Date('2026-07-20T10:00:00'),
      id: 'stale',
      project: null,
      status: 'delivered',
      updatedAt: new Date('2026-08-30T11:59:00'),
    } as unknown as AcceptanceListItem;

    expect(groupAcceptanceList([stale], 'time', now).map(({ key }) => key)).toEqual(['earlier']);
  });
});

describe('shouldRenderAcceptanceGroups', () => {
  const ungrouped = groupAcceptanceList([item('one', null)]);
  const withProject = groupAcceptanceList([item('one', { id: 'p1', name: 'Alpha' })]);

  it('skips a lone "ungrouped" header that would say nothing', () => {
    expect(shouldRenderAcceptanceGroups('project', ungrouped)).toBe(false);
    expect(shouldRenderAcceptanceGroups('project', withProject)).toBe(true);
  });

  it('always sections for an explicitly chosen mode', () => {
    expect(shouldRenderAcceptanceGroups('none', [])).toBe(false);
    expect(
      shouldRenderAcceptanceGroups(
        'status',
        groupAcceptanceList([dated('a', 'delivered', '2026-08-30T00:00:00Z')], 'status'),
      ),
    ).toBe(true);
  });
});

describe('normalizeAcceptanceGroupMode', () => {
  it('falls back to project grouping for malformed persisted values', () => {
    expect(normalizeAcceptanceGroupMode('unknown')).toBe('project');
    expect(normalizeAcceptanceGroupMode(null)).toBe('project');
    expect(normalizeAcceptanceGroupMode('time')).toBe('time');
  });
});

describe('accordion expansion state', () => {
  it('keeps a group that appears after mount expanded, and remembers manual collapses', () => {
    const groups = groupAcceptanceList([
      item('one', { id: 'p1', name: 'Alpha' }),
      item('two', { id: 'p2', name: 'Beta' }),
    ]);

    expect(expandedAcceptanceGroupKeys(groups, [])).toEqual(['p1', 'p2']);
    expect(expandedAcceptanceGroupKeys(groups, ['p1'])).toEqual(['p2']);

    // A delivery filed into a brand-new project adds a group the user has never
    // seen: it must come in expanded, or the row they just moved vanishes.
    const withNewGroup = groupAcceptanceList([
      item('one', { id: 'p1', name: 'Alpha' }),
      item('two', { id: 'p2', name: 'Beta' }),
      item('three', { id: 'p3', name: 'Gamma' }),
    ]);

    expect(expandedAcceptanceGroupKeys(withNewGroup, ['p1'])).toEqual(['p2', 'p3']);
  });

  it('keeps a collapsed group that the active filter hides out of view', () => {
    const all = groupAcceptanceList([
      item('one', { id: 'p1', name: 'Alpha' }),
      item('two', { id: 'p2', name: 'Beta' }),
    ]);
    // The user collapses Alpha while both groups are listed.
    const collapsed = nextCollapsedGroupKeys([], all, ['p2']);
    expect(collapsed).toEqual(['p1']);

    // A search now hides Alpha entirely; toggling Beta must not forget Alpha.
    const filtered = groupAcceptanceList([item('two', { id: 'p2', name: 'Beta' })]);
    const afterToggle = nextCollapsedGroupKeys(collapsed, filtered, []);
    expect(afterToggle).toEqual(['p1', 'p2']);

    // Clearing the search brings Alpha back — still collapsed, as the user left it.
    expect(expandedAcceptanceGroupKeys(all, afterToggle)).toEqual([]);
    expect(
      expandedAcceptanceGroupKeys(all, nextCollapsedGroupKeys(afterToggle, filtered, ['p2'])),
    ).toEqual(['p2']);
  });
});

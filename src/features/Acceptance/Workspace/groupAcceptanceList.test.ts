import { describe, expect, it } from 'vitest';

import type { AcceptanceListItem } from '@/services/verify';

import {
  expandedAcceptanceGroupKeys,
  groupAcceptanceList,
  hasProjectAcceptanceGroups,
  nextCollapsedGroupKeys,
} from './groupAcceptanceList';

const item = (id: string, project: { id: string; name: string } | null): AcceptanceListItem =>
  ({ id, project }) as AcceptanceListItem;

describe('groupAcceptanceList', () => {
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

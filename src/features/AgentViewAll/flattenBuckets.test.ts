import { type SidebarAgentItem } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { flattenAgentBuckets } from './flattenBuckets';

const item = (id: string): SidebarAgentItem =>
  ({ id, title: id, type: 'agent' }) as SidebarAgentItem;

describe('flattenAgentBuckets', () => {
  it('includes pinned items ahead of grouped and ungrouped ones', () => {
    // Regression: the private view-all list originally omitted the pinned
    // bucket, so pinned private agents vanished from /agents?tab=private.
    const result = flattenAgentBuckets(
      [item('pinned-1')],
      [{ items: [item('grouped-1')] }, { items: [item('grouped-2')] }],
      [item('ungrouped-1')],
    );

    expect(result.map((r) => r.id)).toEqual(['pinned-1', 'grouped-1', 'grouped-2', 'ungrouped-1']);
  });

  it('dedupes by id with the first occurrence winning', () => {
    const result = flattenAgentBuckets(
      [item('a')],
      [{ items: [item('a'), item('b')] }],
      [item('b'), item('c')],
    );

    expect(result.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });
});

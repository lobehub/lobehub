import { describe, expect, it } from 'vitest';

import {
  filterWorkspaceMarketItems,
  type WorkspaceMarketStatusFilterValue,
} from './filterWorkspaceMarketItems';

interface TestItem {
  description: string;
  status: WorkspaceMarketStatusFilterValue;
  title: string;
}

describe('filterWorkspaceMarketItems', () => {
  const items: TestItem[] = [
    {
      description: 'Published sales helper',
      status: 'published',
      title: 'Sales Assistant',
    },
    {
      description: 'Draft marketing helper',
      status: 'unpublished',
      title: 'Marketing Assistant',
    },
    {
      description: 'Archived operations helper',
      status: 'archived',
      title: 'Ops Assistant',
    },
  ];

  it('filters items by status', () => {
    expect(
      filterWorkspaceMarketItems({
        getDescription: (item) => item.description,
        getTitle: (item) => item.title,
        items,
        searchQuery: '',
        status: 'unpublished',
      }),
    ).toEqual([items[1]]);
  });

  it('filters items by search query case-insensitively', () => {
    expect(
      filterWorkspaceMarketItems({
        getDescription: (item) => item.description,
        getTitle: (item) => item.title,
        items,
        searchQuery: 'SALES',
        status: 'published',
      }),
    ).toEqual([items[0]]);
  });
});

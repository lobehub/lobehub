export type WorkspaceMarketStatusFilterValue =
  | 'published'
  | 'unpublished'
  | 'deprecated'
  | 'archived';

interface WorkspaceMarketStatusItem {
  status?: WorkspaceMarketStatusFilterValue;
}

interface FilterWorkspaceMarketItemsParams<T extends WorkspaceMarketStatusItem> {
  getDescription: (item: T) => string | null | undefined;
  getTitle: (item: T) => string | null | undefined;
  items: T[];
  searchQuery: string;
  status: WorkspaceMarketStatusFilterValue;
}

export const filterWorkspaceMarketItems = <T extends WorkspaceMarketStatusItem>({
  getDescription,
  getTitle,
  items,
  searchQuery,
  status,
}: FilterWorkspaceMarketItemsParams<T>) => {
  const query = searchQuery.trim().toLowerCase();

  return items.filter((item) => {
    if (item.status !== status) return false;
    if (!query) return true;

    const title = getTitle(item)?.toLowerCase() || '';
    const description = getDescription(item)?.toLowerCase() || '';

    return title.includes(query) || description.includes(query);
  });
};

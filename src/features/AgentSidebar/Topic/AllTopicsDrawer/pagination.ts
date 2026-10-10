interface BackfillTopicPagesOptions {
  canLoadMore: () => boolean;
  count: number;
  itemsNeeded: number;
  loadMore: () => Promise<void>;
  pageSize: number;
}

export const backfillTopicPages = async ({
  canLoadMore,
  count,
  itemsNeeded,
  loadMore,
  pageSize,
}: BackfillTopicPagesOptions) => {
  const pagesNeeded = Math.ceil(Math.max(itemsNeeded - count, 0) / pageSize);

  for (let page = 0; page < pagesNeeded; page++) {
    if (!canLoadMore()) break;
    await loadMore();
  }
};

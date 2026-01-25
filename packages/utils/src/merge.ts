import { merge as _merge, isEmpty, mergeWith } from 'lodash-es';

/**
 * 用于合并对象，如果是数组则直接替换
 * @param target
 * @param source
 */
export const merge: typeof _merge = <T = object>(target: T, source: T) =>
  mergeWith({}, target, source, (obj, src) => {
    if (Array.isArray(obj)) return src;
  });

type MergeableItem = {
  [key: string]: any;
  id?: string;
};

/**
 * Merge two arrays based on id, preserving metadata from default items
 * @param defaultItems Items with default configuration and metadata
 * @param userItems User-defined items with higher priority
 */
export const mergeArrayById = <T extends MergeableItem>(defaultItems: T[], userItems: T[]): T[] => {
  const ensuredDefaultItems = defaultItems.filter((item): item is T & Required<Pick<T, 'id'>> =>
    Boolean(item?.id),
  );

  const defaultItemsMap = new Map(
    ensuredDefaultItems.map((item, index) => [item.id, { index, item }]),
  );

  // 检查是否有用户自定义排序
  const hasCustomSort = userItems.some((item) => {
    const sortValue = (item as any)?.sort;
    return typeof sortValue === 'number' && Number.isFinite(sortValue);
  });

  const idlessUserItems: T[] = [];
  const mergedMap = new Map<string, { defaultIndex?: number; item: T; userSort?: number }>();

  // 第一步：处理 userItems，合并属性
  userItems.forEach((userItem) => {
    const userId = userItem?.id;

    if (!userId) {
      idlessUserItems.push(userItem);
      return;
    }

    const defaultMeta = defaultItemsMap.get(userId);
    const mergedItem = defaultMeta ? ({ ...defaultMeta.item } as T) : ({ ...userItem } as T);

    if (defaultMeta) {
      Object.entries(userItem).forEach(([key, value]) => {
        if (
          value !== null &&
          value !== undefined &&
          !(typeof value === 'object' && isEmpty(value))
        ) {
          // @ts-expect-error
          mergedItem[key] = value;
        }

        if (typeof value === 'object' && !isEmpty(value)) {
          // @ts-expect-error
          mergedItem[key] = merge(defaultMeta.item[key], value);
        }
      });
    }

    const sortValue = (userItem as any)?.sort;
    const userSort =
      typeof sortValue === 'number' && Number.isFinite(sortValue) ? sortValue : undefined;

    mergedMap.set(userId, {
      defaultIndex: defaultMeta?.index,
      item: mergedItem,
      userSort,
    });
  });

  // 第二步：添加 defaultItems 中存在但 userItems 中不存在的项
  defaultItems.forEach((item, index) => {
    const itemId = item?.id;
    if (!itemId) return;

    if (mergedMap.has(itemId)) {
      const entry = mergedMap.get(itemId)!;
      if (typeof entry.defaultIndex !== 'number') entry.defaultIndex = index;
      return;
    }

    mergedMap.set(itemId, {
      defaultIndex: index,
      item: { ...item } as T,
    });
  });

  const entries = Array.from(mergedMap.values());

  // 第三步：根据是否有自定义排序来决定最终顺序
  if (hasCustomSort) {
    // 有自定义排序：按 sort 排序，没有 sort 的项尝试智能插入
    const sortedEntries = entries.filter((e) => typeof e.userSort === 'number');
    const unsortedEntries = entries.filter((e) => typeof e.userSort !== 'number');

    // 按 sort 排序
    sortedEntries.sort((a, b) => {
      const sortDiff = (a.userSort as number) - (b.userSort as number);
      if (sortDiff !== 0) return sortDiff;
      // sort 相同时，按 defaultIndex 排序
      if (typeof a.defaultIndex === 'number' && typeof b.defaultIndex === 'number') {
        return a.defaultIndex - b.defaultIndex;
      }
      return 0;
    });

    // 处理未排序的项（新启用的模型）
    const result: T[] = [...idlessUserItems];
    const sortedItems = sortedEntries.map((e) => e.item);
    const sortedIds = new Set(sortedEntries.map((e) => e.item.id));

    // 对每个未排序的项，尝试找到合适的插入位置
    unsortedEntries.forEach((unsortedEntry) => {
      if (typeof unsortedEntry.defaultIndex !== 'number') {
        // 无法判断位置，放到最前面
        result.unshift(unsortedEntry.item);
        return;
      }

      // 在 defaultItems 中找到它前后的邻居
      let insertIndex = -1;

      // 向后查找：找到第一个在排序列表中的邻居
      for (let i = unsortedEntry.defaultIndex + 1; i < defaultItems.length; i++) {
        const neighborId = defaultItems[i]?.id;
        if (neighborId && sortedIds.has(neighborId)) {
          const neighborIndex = sortedItems.findIndex((item) => item.id === neighborId);
          insertIndex = neighborIndex;
          break;
        }
      }

      // 如果向后没找到，向前查找
      if (insertIndex === -1) {
        for (let i = unsortedEntry.defaultIndex - 1; i >= 0; i--) {
          const neighborId = defaultItems[i]?.id;
          if (neighborId && sortedIds.has(neighborId)) {
            const neighborIndex = sortedItems.findIndex((item) => item.id === neighborId);
            insertIndex = neighborIndex + 1;
            break;
          }
        }
      }

      // 如果还是没找到合适位置，放到最前面
      if (insertIndex === -1) {
        result.unshift(unsortedEntry.item);
      } else {
        sortedItems.splice(insertIndex, 0, unsortedEntry.item);
      }
    });

    return [...result, ...sortedItems];
  } else {
    // 没有自定义排序：完全按 defaultItems 的顺序
    const result: T[] = [...idlessUserItems];

    // 先添加在 defaultItems 中的项（按原顺序）
    defaultItems.forEach((defaultItem) => {
      const itemId = defaultItem?.id;
      if (!itemId) return;

      const entry = mergedMap.get(itemId);
      if (entry) {
        result.push(entry.item);
      }
    });

    // 再添加自定义的项（不在 defaultItems 中的）
    entries.forEach((entry) => {
      if (typeof entry.defaultIndex !== 'number') {
        result.push(entry.item);
      }
    });

    return result;
  }
};

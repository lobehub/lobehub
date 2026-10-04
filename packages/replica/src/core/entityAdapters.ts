import type { ReplicaEntityAdapter } from './engine';

/**
 * The value IS one entity, or wraps one (`{ project, members }`). Deleting the
 * entity drops the whole value.
 */
export const singleEntity = <TData, TItem = TData>(
  getId: (item: TItem) => string,
  lens?: { get: (data: TData) => TItem; set: (data: TData, item: TItem) => TData },
): ReplicaEntityAdapter<TData, TItem> => {
  const pick = (data: TData) => (lens ? lens.get(data) : (data as unknown as TItem));
  return {
    has: (data, id) => getId(pick(data)) === id,
    map: (data, _id, fn) => {
      const current = pick(data);
      const next = fn(current);
      if (next === undefined) return undefined;
      if (next === current) return data;
      return lens ? lens.set(data, next) : (next as unknown as TData);
    },
  };
};

/** The value is a plain list of entities; deleting one filters it out. */
export const arrayEntity = <TItem>(
  getId: (item: TItem) => string,
): ReplicaEntityAdapter<TItem[], TItem> => ({
  has: (data, id) => data.some((item) => getId(item) === id),
  map: (data, id, fn) => {
    let changed = false;
    const next: TItem[] = [];
    for (const item of data) {
      if (getId(item) !== id) {
        next.push(item);
        continue;
      }
      const mapped = fn(item);
      if (mapped !== item) changed = true;
      if (mapped !== undefined) next.push(mapped);
    }
    return changed ? next : data;
  },
});

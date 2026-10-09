import { useCallback, useState } from 'react';

/**
 * Which items have a request in flight, tracked per item.
 *
 * A set rather than one id: two requests can overlap, and with a single id the
 * second moved the spinner off the first, and whichever settled first cleared
 * the other's busy state — re-enabling an action whose request was still
 * running.
 */
export const usePendingIds = () => {
  const [ids, setIds] = useState<ReadonlySet<string>>(() => new Set());

  const add = useCallback((id: string) => setIds((current) => new Set(current).add(id)), []);

  const remove = useCallback(
    (id: string) =>
      setIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      }),
    [],
  );

  const has = useCallback((id: string) => ids.has(id), [ids]);

  return { add, has, remove };
};

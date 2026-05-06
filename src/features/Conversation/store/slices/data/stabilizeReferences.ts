/**
 * Recursively replace references in `next` with references from `prev`
 * where the values are deeply equal.
 *
 * Why: `parse()` from @lobechat/conversation-flow rebuilds the entire
 * displayMessages tree on every dispatch (including streaming chunks), which
 * gives every message / block / tool / result a fresh reference. That defeats
 * `memo` and `useStore(selector, isEqual)` for unchanged subtrees and causes
 * the assistant message subtree to re-render entirely on every chunk. Walking
 * old vs new and pinning unchanged subtrees back to their previous reference
 * preserves identity so React and Zustand can bail out as designed.
 */
export const stabilizeReferences = <T>(prev: T, next: T): T => {
  if (Object.is(prev, next)) return prev;

  if (prev === null || next === null || typeof prev !== 'object' || typeof next !== 'object') {
    return next;
  }

  const prevIsArray = Array.isArray(prev);
  const nextIsArray = Array.isArray(next);
  if (prevIsArray !== nextIsArray) return next;

  if (prevIsArray && nextIsArray) {
    const prevArr = prev as unknown[];
    const nextArr = next as unknown[];
    if (prevArr.length !== nextArr.length) return next;

    let allSame = true;
    const result: unknown[] = Array.from({ length: nextArr.length });
    for (let i = 0; i < nextArr.length; i++) {
      const stab = stabilizeReferences(prevArr[i], nextArr[i]);
      if (stab !== prevArr[i]) allSame = false;
      result[i] = stab;
    }
    return (allSame ? prev : (result as unknown)) as T;
  }

  const prevObj = prev as Record<string, unknown>;
  const nextObj = next as Record<string, unknown>;
  const prevKeys = Object.keys(prevObj);
  const nextKeys = Object.keys(nextObj);
  if (prevKeys.length !== nextKeys.length) return next;
  for (const key of nextKeys) {
    if (!Object.prototype.hasOwnProperty.call(prevObj, key)) return next;
  }

  let allSame = true;
  const result: Record<string, unknown> = {};
  for (const key of nextKeys) {
    const stab = stabilizeReferences(prevObj[key], nextObj[key]);
    if (stab !== prevObj[key]) allSame = false;
    result[key] = stab;
  }
  return (allSame ? prev : (result as unknown)) as T;
};

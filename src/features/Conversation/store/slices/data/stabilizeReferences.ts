import { replaceEqualDeep } from '@tanstack/react-query';

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
export const stabilizeReferences = <T>(prev: T, next: T): T => replaceEqualDeep(prev, next);

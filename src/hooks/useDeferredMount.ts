import { useDeferredValue } from 'react';

// Returns `false` for the mount commit, then flips to `true` in a deferred
// (interruptible, background-priority) follow-up render — React 19's
// `useDeferredValue` initialValue trick. Gate a heavy subtree behind it with a
// skeleton so its mount happens right after the navigation frame paints
// instead of on the route transition's critical path.
export const useDeferredMount = (): boolean => useDeferredValue(true, false);

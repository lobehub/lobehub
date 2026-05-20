import { useLayoutEffect, useRef } from 'react';

// FIXME: This guard is a v1 workaround. The underlying problem is that
// `MainChatInput` writes its editor instance into the global `useChatStore.mainInputEditor`
// slot without scoping it to the ConversationProvider store. As a result, mounting
// two chat inputs on the same page silently clobbers each other. The real fix is to
// scope `mainInputEditor` to the ConversationProvider store. Remove this guard once
// that refactor lands.
const mountedInstances = new Set<symbol>();

/**
 * Enforces a single-instance-per-page invariant for FloatingChatPanel.
 * Throws inside `useLayoutEffect` if a second instance mounts while the first is alive.
 *
 * Note: this guard only detects multiple FloatingChatPanel siblings. It does NOT detect
 * coexistence with the main-page ConversationArea, which also uses MainChatInput.
 * Consumers must ensure FloatingChatPanel and ConversationArea don't render simultaneously.
 */
export const useSingleInstanceGuard = () => {
  const idRef = useRef<symbol | null>(null);
  if (!idRef.current) idRef.current = Symbol('FloatingChatPanel');

  useLayoutEffect(() => {
    if (mountedInstances.size > 0) {
      throw new Error(
        '[FloatingChatPanel] Only one instance allowed per page. ' +
          'Multiple instances would conflict over global chatStore.mainInputEditor. ' +
          'Ensure the previous instance is unmounted before mounting a new one.',
      );
    }
    const id = idRef.current!;
    mountedInstances.add(id);
    return () => {
      mountedInstances.delete(id);
    };
  }, []);
};

/**
 * Test-only: reset the internal registry between tests.
 * Do not call this in production code.
 */
export const __resetFloatingChatPanelRegistry = () => {
  mountedInstances.clear();
};

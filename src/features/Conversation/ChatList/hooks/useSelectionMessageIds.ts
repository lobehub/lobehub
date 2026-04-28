import { useEffect, useState } from 'react';

const MESSAGE_ID_ATTR = 'data-message-id';

const findMessageIdFromNode = (node: Node | null): string | null => {
  let cur: Node | null = node;
  while (cur) {
    if (cur.nodeType === Node.ELEMENT_NODE) {
      const id = (cur as HTMLElement).getAttribute?.(MESSAGE_ID_ATTR);
      if (id) return id;
    }
    cur = cur.parentNode;
  }
  return null;
};

const setsEqual = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean => {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
};

/**
 * Track which message items currently contain the active text selection so
 * the virtualized list can pin them with `keepMounted`. Recycling a node
 * that hosts a Selection endpoint would drop the selection entirely.
 */
export const useSelectionMessageIds = (): ReadonlySet<string> => {
  const [ids, setIds] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    const handler = () => {
      const sel = typeof window === 'undefined' ? null : window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
        setIds((prev) => (prev.size === 0 ? prev : new Set()));
        return;
      }

      const next = new Set<string>();
      for (let i = 0; i < sel.rangeCount; i++) {
        const range = sel.getRangeAt(i);
        const startId = findMessageIdFromNode(range.startContainer);
        const endId = findMessageIdFromNode(range.endContainer);
        if (startId) next.add(startId);
        if (endId) next.add(endId);
      }

      setIds((prev) => (setsEqual(prev, next) ? prev : next));
    };

    document.addEventListener('selectionchange', handler);
    return () => document.removeEventListener('selectionchange', handler);
  }, []);

  return ids;
};

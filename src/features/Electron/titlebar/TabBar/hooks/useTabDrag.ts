import { useLatest } from 'ahooks';
import { type MotionValue, useMotionValue } from 'motion/react';
import {
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import { resolveDropTarget } from '../tabDrag';
import { type StripTab } from '../tabLayout';

// Same as the dnd-kit PointerSensor it replaces: a plain click must not start a drag.
const DRAG_THRESHOLD = 4;

export interface TabDragSession {
  grabFraction: number;
  id: string;
  pinned: boolean;
  toIndex: number;
}

interface UseTabDragOptions {
  activeTabId: string | null;
  onDrop: (id: string, toIndex: number, pinned: boolean) => void;
  stripRef: RefObject<HTMLElement | null>;
  stripWidth: number;
  tabs: StripTab[];
}

export interface TabDrag {
  /** Pointer x relative to the strip's origin, updated on every move without a render. */
  pointerX: MotionValue<number>;
  session: TabDragSession | null;
  startDrag: (id: string, event: ReactPointerEvent<HTMLElement>) => void;
}

export const useTabDrag = (options: UseTabDragOptions): TabDrag => {
  const latest = useLatest(options);
  const pointerX = useMotionValue(0);
  const [session, setSession] = useState<TabDragSession | null>(null);
  const teardown = useRef<(() => void) | null>(null);

  useEffect(() => () => teardown.current?.(), []);

  const startDrag = useCallback(
    (id: string, event: ReactPointerEvent<HTMLElement>) => {
      const strip = latest.current.stripRef.current;
      if (!strip || teardown.current) return;

      const { pointerId, clientX: startX } = event;
      const originX = strip.getBoundingClientRect().left;
      const rect = event.currentTarget.getBoundingClientRect();
      const grabFraction = rect.width > 0 ? (startX - rect.left) / rect.width : 0.5;
      let current: TabDragSession | null = null;

      const finish = (commit: boolean) => {
        teardown.current?.();
        if (commit && current) latest.current.onDrop(current.id, current.toIndex, current.pinned);
        setSession(null);
      };

      const update = (clientX: number) => {
        const { activeTabId, stripWidth, tabs } = latest.current;
        const own = tabs.find((tab) => tab.id === id);
        if (!own) return finish(false);

        const pinned = current ? current.pinned : own.pinned;
        const x = clientX - originX;
        pointerX.set(x);

        const target = resolveDropTarget({
          activeId: activeTabId,
          draggedId: id,
          grabFraction,
          pointerX: x,
          stripWidth,
          tabs: tabs.map((tab) => (tab.id === id ? { id, pinned } : tab)),
        });
        const toIndex = target.findIndex((tab) => tab.id === id);
        const next = { grabFraction, id, pinned: target[toIndex].pinned, toIndex };
        if (current && current.toIndex === next.toIndex && current.pinned === next.pinned) return;

        current = next;
        setSession(next);
      };

      const handleMove = (e: PointerEvent) => {
        if (e.pointerId !== pointerId) return;
        if (!current && Math.abs(e.clientX - startX) < DRAG_THRESHOLD) return;
        update(e.clientX);
      };
      const handleUp = (e: PointerEvent) => {
        if (e.pointerId === pointerId) finish(true);
      };
      const handleCancel = (e: PointerEvent) => {
        if (e.pointerId === pointerId) finish(false);
      };
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key !== 'Escape' || !current) return;
        e.preventDefault();
        e.stopPropagation();
        finish(false);
      };
      const handleBlur = () => finish(false);

      window.addEventListener('pointermove', handleMove);
      window.addEventListener('pointerup', handleUp);
      window.addEventListener('pointercancel', handleCancel);
      window.addEventListener('keydown', handleKeyDown, true);
      window.addEventListener('blur', handleBlur);
      teardown.current = () => {
        window.removeEventListener('pointermove', handleMove);
        window.removeEventListener('pointerup', handleUp);
        window.removeEventListener('pointercancel', handleCancel);
        window.removeEventListener('keydown', handleKeyDown, true);
        window.removeEventListener('blur', handleBlur);
        teardown.current = null;
      };
    },
    [latest, pointerX],
  );

  return { pointerX, session, startDrag };
};

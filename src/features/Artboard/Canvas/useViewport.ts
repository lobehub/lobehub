import { type PointerEvent, type RefObject, useCallback, useEffect, useRef, useState } from 'react';

import { type BoardModel, type Rect, toBounds } from '../model';
import { useArtboardStore } from '../store';
import { createPageViews } from './pageViews';

export interface ViewState {
  k: number;
  x: number;
  y: number;
}

const MIN_K = 0.08;
const MAX_K = 2;
const FLY_MS = 480;
const OUTLINE_INSET = 200;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

const zoomAround = (v: ViewState, k: number, px: number, py: number): ViewState => ({
  k,
  x: px - ((px - v.x) / v.k) * k,
  y: py - ((py - v.y) / v.k) * k,
});

const LABEL_SPACE = 40;

const itemRect = (board: BoardModel, id: string): Rect | undefined => {
  const item = board.boardById[id];
  if (!item) return;
  const rect = toBounds(item.rect);
  return { ...rect, minY: rect.minY - LABEL_SPACE };
};

const groupBounds = (board: BoardModel, id: string | undefined): Rect | undefined => {
  const group = id ? board.groups.find((g) => g.id === id) : undefined;
  if (!group) return;
  const rect = toBounds(group.rect);
  return { ...rect, minY: rect.minY - LABEL_SPACE };
};

export const useViewport = (
  ref: RefObject<HTMLDivElement | null>,
  board: BoardModel,
  onBackgroundClick: () => void,
) => {
  const [view, setView] = useState<ViewState>({ k: 0.3, x: 40, y: 200 });
  const [flying, setFlying] = useState(false);
  const [panning, setPanning] = useState(false);
  const drag = useRef<{
    moved: boolean;
    onItem: boolean;
    pointerId: number;
    sx: number;
    sy: number;
    vx: number;
    vy: number;
  }>(null);
  const suppressClick = useRef(false);
  const target = useRef<{ pad: number; rect: Rect } | null>({ pad: 80, rect: board.bounds });
  const boardRef = useRef(board);
  boardRef.current = board;
  const flyTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const animate = useCallback(() => {
    setFlying(true);
    clearTimeout(flyTimer.current);
    flyTimer.current = setTimeout(() => setFlying(false), FLY_MS);
  }, []);

  const fit = useCallback(
    (b: Rect, smooth = true, pad = 80) => {
      const el = ref.current;
      if (!el) return;
      target.current = { pad, rect: b };
      const { mode, outlineOpen } = useArtboardStore.getState();
      const inset = outlineOpen && mode === 'discuss' ? OUTLINE_INSET : 0;
      const vw = el.clientWidth - inset;
      const vh = el.clientHeight;
      const k = clamp(
        Math.min((vw - pad * 2) / (b.maxX - b.minX), (vh - pad * 2) / (b.maxY - b.minY)),
        MIN_K,
        1,
      );
      if (smooth) animate();
      setView({
        k,
        x: inset + vw / 2 - ((b.minX + b.maxX) / 2) * k,
        y: vh / 2 - ((b.minY + b.maxY) / 2) * k,
      });
    },
    [animate, ref],
  );

  const zoomBy = useCallback(
    (factor: number) => {
      const el = ref.current;
      if (!el) return;
      target.current = null;
      animate();
      setView((v) =>
        zoomAround(v, clamp(v.k * factor, MIN_K, MAX_K), el.clientWidth / 2, el.clientHeight / 2),
      );
    },
    [animate, ref],
  );

  const fitAll = useCallback(() => fit(boardRef.current.bounds), [fit]);

  const pageViews = useRef(createPageViews<ViewState>());
  const pageRef = useRef(board.pageId);
  const viewRef = useRef(view);
  viewRef.current = view;
  useEffect(() => {
    const previous = pageRef.current;
    if (previous === board.pageId) return;
    pageRef.current = board.pageId;
    const saved = pageViews.current.swap(previous, board.pageId, viewRef.current);
    if (!saved) return fit(boardRef.current.bounds, false);
    target.current = null;
    setFlying(false);
    setView(saved);
  }, [board.pageId, fit]);

  const outlineOpen = useArtboardStore((s) => s.outlineOpen);
  useEffect(() => {
    const t = target.current;
    if (t) fit(t.rect, true, t.pad);
  }, [fit, outlineOpen]);

  const camera = useArtboardStore((s) => s.camera);
  useEffect(() => {
    if (!camera) return;
    const current = boardRef.current;
    if (camera.kind === 'all') return fitAll();
    if (camera.kind === 'item') {
      const rect = itemRect(current, camera.id);
      if (rect) fit(rect, true, 120);
      return;
    }
    const rect = groupBounds(
      current,
      camera.kind === 'journey' ? current.journeyGroupId : camera.id,
    );
    if (rect) fit(rect, true, 48);
  }, [camera, fit, fitAll]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      const t = target.current;
      if (t) fit(t.rect, false, t.pad);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [fit, ref]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      target.current = null;
      setFlying(false);
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      if (e.ctrlKey || e.metaKey) {
        setView((v) =>
          zoomAround(v, clamp(v.k * Math.exp(-e.deltaY * 0.01), MIN_K, MAX_K), px, py),
        );
      } else {
        setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [ref]);

  useEffect(() => () => clearTimeout(flyTimer.current), []);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || drag.current) return;
    drag.current = {
      moved: false,
      onItem: !!(e.target as HTMLElement).closest('[data-board-item]'),
      pointerId: e.pointerId,
      sx: e.clientX,
      sy: e.clientY,
      vx: view.x,
      vy: view.y,
    };
    setFlying(false);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    if (!d.moved) {
      d.moved = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      target.current = null;
      setPanning(true);
    }
    setView((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy }));
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (d && d.pointerId !== e.pointerId) return;
    drag.current = null;
    setPanning(false);
    if (d?.moved) suppressClick.current = true;
    if (d && !d.moved && !d.onItem) onBackgroundClick();
  };

  const onClickCapture = (e: { stopPropagation: () => void }) => {
    if (!suppressClick.current) return;
    suppressClick.current = false;
    e.stopPropagation();
  };

  return {
    fitAll,
    flying,
    handlers: {
      onClickCapture,
      onPointerCancel: onPointerUp,
      onPointerDown,
      onPointerMove,
      onPointerUp,
    },
    panning,
    view,
    zoomBy,
  };
};

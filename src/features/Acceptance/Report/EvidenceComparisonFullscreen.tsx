'use client';

import { ActionIcon, Flexbox, Segmented, Text, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Minus, Plus, X } from 'lucide-react';
import type { ReactNode, RefObject } from 'react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { useLocalStorageState } from '@/hooks/useLocalStorageState';
import { densityTokens } from '@/styles/density.stylex';
import { sx } from '@/styles/sx';

import {
  pinchedZoom,
  type Point,
  touchDistance,
  touchMidpoint,
} from '../Viewer/Evidence/pinchZoom';
import {
  boundView,
  containedFrame,
  DOUBLE_CLICK_SCALE,
  FIT_VIEW,
  MAX_SCALE,
  MIN_SCALE,
  panView,
  sharedFrame,
  type ZoomFrame,
  type ZoomView,
  zoomViewAt,
} from './syncedZoom';

/** Inset between a pane edge and its image, in px. */
const PAD = 12;
/** Wheel delta → scale factor; small enough for trackpad pinch deltas (≈1–10 per event). */
const WHEEL_ZOOM_SPEED = 0.01;
const STEP = 1.25;
const MODE_STORAGE_KEY = 'lobehub-acceptance-comparison-mode';

/** `side` shows both halves at once; `flip` shows one at a time in the same place. */
type ComparisonMode = 'flip' | 'side';
type ComparisonRole = 'after' | 'before';

const fadeIn = stylex.keyframes({ from: { opacity: 0 }, to: { opacity: 1 } });

const styles = stylex.create({
  overlay: {
    position: 'fixed',
    zIndex: 1100,
    inset: 0,
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: cssVar.colorBgLayout,
    backgroundImage: 'none',
    animationName: fadeIn,
    animationDuration: '150ms',
  },
  bar: {
    flex: 'none',
    height: '48px',
    paddingInlineStart: '16px',
    paddingInlineEnd: '8px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  zoomBox: {
    height: densityTokens['--lobe-density-small-control-height'],
    paddingInline: '2px',
    borderRadius: '6px',
    backgroundColor: cssVar.colorFillTertiary,
    backgroundImage: 'none',
  },
  zoomValue: {
    cursor: 'pointer',
    appearance: 'none',
    margin: 0,
    padding: 0,
    borderWidth: 0,
    borderStyle: 'none',
    borderColor: 'currentcolor',
    font: 'inherit',
    color: 'inherit',
    backgroundColor: 'transparent',
    backgroundImage: 'none',
    minWidth: '44px',
    fontSize: '12px',
    fontVariantNumeric: 'tabular-nums',
    textAlign: 'center',
  },
  /* Each side is a band row plus a pane row. The sides share the stage's rows
     through subgrid, so a missing or wrapped caption on one side cannot make
     its pane a different size: both panes stay equal, which the one shared
     zoom relies on. */
  stage: {
    flex: '1',
    minHeight: 0,
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gridTemplateRows: 'auto minmax(0, 1fr)',
    columnGap: '1px',
    rowGap: 0,
    backgroundColor: cssVar.colorBorderSecondary,
    backgroundImage: 'none',
  },
  stageVertical: {
    gridTemplateColumns: 'minmax(0, 1fr)',
    gridTemplateRows: 'auto minmax(0, 1fr) auto minmax(0, 1fr)',
    columnGap: 0,
  },
  side: {
    display: 'grid',
    gridRow: 'span 2',
    gridTemplateRows: 'subgrid',
    minWidth: 0,
    minHeight: 0,
    backgroundColor: cssVar.colorBgLayout,
    backgroundImage: 'none',
  },
  stageSingle: {
    gridTemplateColumns: 'minmax(0, 1fr)',
    columnGap: 0,
  },
  sideStackedAfter: {
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorBorderSecondary,
  },
  pane: {
    gridRow: '2',
    position: 'relative',
    overflow: 'hidden',
    flex: '1',
    minHeight: 0,
    backgroundColor: cssVar.colorBgLayout,
    backgroundImage: 'none',
    touchAction: 'none',
    userSelect: 'none',
  },
  paneZoomed: {
    cursor: { 'default': 'grab', ':active': 'grabbing' },
  },
  content: {
    position: 'absolute',
    inset: `${PAD}px`,
    transformOrigin: '0 0',
    willChange: 'transform',
  },
  contentHidden: {
    visibility: 'hidden',
  },
  image: {
    pointerEvents: 'none',
    display: 'block',
    width: '100%',
    height: '100%',
    objectFit: 'contain',
  },
});

export interface FullscreenComparisonSide {
  alt: string;
  /** The tinted role band, rendered by the card so both views share it. */
  band?: ReactNode;
  src: string;
}

/**
 * One shared zoom for both panes. Mac trackpad pinch arrives as `wheel` with
 * `ctrlKey` (Chromium, Firefox) or as `gesture*` events (Safari); two-finger
 * scroll arrives as a plain `wheel` and pans. A mouse zooms with ⌘/Ctrl +
 * wheel and drags to pan. Listeners are native because React's `onWheel` is
 * passive and cannot stop the page from zooming.
 */
const useSyncedZoom = (mode: ComparisonMode) => {
  const [view, setView] = useState<ZoomView>(FIT_VIEW);
  const panes = useRef<(HTMLDivElement | null)[]>([]);
  const images = useRef<(HTMLImageElement | null)[]>([]);
  // Native listeners are bound once; they read the live view from here.
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  // Both panes are equal cells of one grid, so the first one's box serves both;
  // the bounds keep to the area both pictures cover, so neither pans blank.
  const paneFrame = (): ZoomFrame => {
    const rect = panes.current[0]?.getBoundingClientRect();
    const w = rect ? rect.width - PAD * 2 : 1;
    const h = rect ? rect.height - PAD * 2 : 1;
    const [a, b] = [0, 1].map((i) =>
      containedFrame(
        w,
        h,
        images.current[i]?.naturalWidth ?? 0,
        images.current[i]?.naturalHeight ?? 0,
      ),
    );
    return sharedFrame(a, b);
  };

  const zoomCenter = useCallback((factor: number) => {
    const frame = paneFrame();
    setView((v) => zoomViewAt(v, v.scale * factor, frame.width / 2, frame.height / 2, frame));
  }, []);
  const reset = useCallback(() => setView(FIT_VIEW), []);

  useEffect(() => {
    const controller = new AbortController();
    for (const pane of panes.current) {
      if (!pane) continue;
      const local = (event: { clientX: number; clientY: number }) => {
        const rect = pane.getBoundingClientRect();
        return [event.clientX - rect.left - PAD, event.clientY - rect.top - PAD] as const;
      };

      const onWheel = (event: WheelEvent) => {
        event.preventDefault();
        const frame = paneFrame();
        if (event.ctrlKey || event.metaKey) {
          const [px, py] = local(event);
          const factor = Math.exp(-event.deltaY * WHEEL_ZOOM_SPEED);
          setView((v) => zoomViewAt(v, v.scale * factor, px, py, frame));
        } else {
          setView((v) => panView(v, -event.deltaX, -event.deltaY, frame));
        }
      };

      // `touch-action: none` turns off the browser's own pinch, so a two-finger
      // touch pinch (Chromium, Android) is tracked here from the pointers.
      const pointers = new Map<number, Point>();
      let pinch: { distance: number; origin: readonly [number, number]; view: ZoomView } | null =
        null;

      // Safari-only GestureEvent: `scale` is relative to the gesture start.
      let gesture: { origin: readonly [number, number]; view: ZoomView } | null = null;
      const onGestureStart = (event: Event) => {
        event.preventDefault();
        gesture = { origin: local(event as unknown as MouseEvent), view: viewRef.current };
      };
      const onGestureChange = (event: Event) => {
        event.preventDefault();
        // iOS Safari reports a touch pinch as both pointers and gestures.
        if (!gesture || pinch) return;
        const frame = paneFrame();
        const { origin, view: start } = gesture;
        const scale = (event as unknown as { scale: number }).scale;
        setView(zoomViewAt(start, start.scale * scale, origin[0], origin[1], frame));
      };

      let drag: { x: number; y: number; view: ZoomView } | null = null;
      const onPointerDown = (event: PointerEvent) => {
        pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        pane.setPointerCapture(event.pointerId);
        if (pointers.size === 2) {
          const [a, b] = [...pointers.values()];
          const mid = touchMidpoint(a, b);
          drag = null;
          pinch = {
            distance: touchDistance(a, b),
            origin: local({ clientX: mid.x, clientY: mid.y }),
            view: viewRef.current,
          };
        } else if (pointers.size === 1 && viewRef.current.scale > MIN_SCALE) {
          drag = { view: viewRef.current, x: event.clientX, y: event.clientY };
        }
      };
      const onPointerMove = (event: PointerEvent) => {
        if (!pointers.has(event.pointerId)) return;
        pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        const frame = paneFrame();
        if (pinch) {
          const [a, b] = [...pointers.values()];
          const { origin, view: start } = pinch;
          const scale = pinchedZoom(
            start.scale,
            pinch.distance,
            touchDistance(a, b),
            MIN_SCALE,
            MAX_SCALE,
          );
          setView(zoomViewAt(start, scale, origin[0], origin[1], frame));
        } else if (drag) {
          setView(panView(drag.view, event.clientX - drag.x, event.clientY - drag.y, frame));
        }
      };
      const onPointerUp = (event: PointerEvent) => {
        pointers.delete(event.pointerId);
        if (pointers.size < 2) pinch = null;
        drag = null;
      };
      const onDoubleClick = (event: MouseEvent) => {
        const frame = paneFrame();
        const [px, py] = local(event);
        setView((v) =>
          v.scale > MIN_SCALE ? FIT_VIEW : zoomViewAt(v, DOUBLE_CLICK_SCALE, px, py, frame),
        );
      };

      const listeners: [string, (event: any) => void][] = [
        ['wheel', onWheel],
        ['gesturestart', onGestureStart],
        ['gesturechange', onGestureChange],
        ['pointerdown', onPointerDown],
        ['pointermove', onPointerMove],
        ['pointerup', onPointerUp],
        ['pointercancel', onPointerUp],
        ['dblclick', onDoubleClick],
      ];
      for (const [type, listener] of listeners)
        pane.addEventListener(type, listener, { passive: false, signal: controller.signal });
    }

    // Offsets are absolute pixels: when the pane resizes (window, rotation) or a
    // picture finishes loading, re-bound the view so it cannot strand both
    // captures outside the shrunken frame.
    const rebound = () => setView((v) => boundView(v, paneFrame()));
    const observer = new ResizeObserver(rebound);
    if (panes.current[0]) observer.observe(panes.current[0]);
    for (const image of images.current)
      image?.addEventListener('load', rebound, { signal: controller.signal });
    return () => {
      controller.abort();
      observer.disconnect();
    };
    // Switching modes mounts different panes: bind to the new ones.
  }, [mode]);

  const bindPane = useCallback(
    (index: number) => (el: HTMLDivElement | null) => {
      panes.current[index] = el;
    },
    [],
  );
  const bindImage = useCallback(
    (index: number) => (el: HTMLImageElement | null) => {
      images.current[index] = el;
    },
    [],
  );

  return { bindImage, bindPane, reset, view, zoomCenter };
};

interface EvidenceComparisonFullscreenProps {
  after: FullscreenComparisonSide;
  before: FullscreenComparisonSide;
  layout: 'horizontal' | 'vertical';
  onClose: () => void;
  /**
   * Where focus goes on close; defaults to the element focused on open. The
   * card passes itself: refocusing its full-screen button would reopen the
   * button's tooltip, which then swallows the next Esc meant for a drawer.
   */
  returnFocusRef?: RefObject<HTMLElement | null>;
}

/**
 * The before/after pair over the whole viewport, each half filling its pane,
 * with one zoom shared by both so small text can be compared in place.
 */
export const EvidenceComparisonFullscreen = memo<EvidenceComparisonFullscreenProps>(
  ({ after, before, layout, onClose, returnFocusRef }) => {
    const { t } = useTranslation('verify');
    const closeRef = useRef<HTMLButtonElement>(null);
    const dialogRef = useRef<HTMLDivElement>(null);
    const [storedMode, setStoredMode] = useLocalStorageState<ComparisonMode>(
      MODE_STORAGE_KEY,
      'flip',
    );
    // Flip is the default: one capture at a time is what opening evidence
    // already shows, so side by side is an opt-in the toggle remembers.
    const mode: ComparisonMode = storedMode === 'side' ? 'side' : 'flip';
    const flip = mode === 'flip';
    // Read by the key handler: as an effect dependency, a mode change would
    // re-run the focus lifecycle below and pull focus back to Close.
    const flipRef = useRef(flip);
    useEffect(() => {
      flipRef.current = flip;
    }, [flip]);
    // Flipping keeps the zoom, so the same region of each capture shows in turn.
    const [shown, setShown] = useState<ComparisonRole>('before');
    const toggleShown = useCallback(
      () => setShown((role) => (role === 'before' ? 'after' : 'before')),
      [],
    );
    const { bindImage, bindPane, reset, view, zoomCenter } = useSyncedZoom(mode);
    const changeMode = (next: ComparisonMode) => {
      // A side-by-side pane is half the size of the flip pane, so the same
      // offsets would point at a different region: start the new mode at fit.
      reset();
      setStoredMode(next);
    };

    useEffect(() => {
      const opener = returnFocusRef?.current ?? (document.activeElement as HTMLElement | null);
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Tab') {
          // The overlay hides the page but does not make it inert: cycle Tab
          // through the dialog's own controls instead of letting it reach the
          // covered report.
          const focusables = [
            // A Segmented moves between its items with the arrow keys and
            // leaves the unselected ones at tabindex -1.
            ...(dialogRef.current?.querySelectorAll<HTMLElement>(
              'button:not([disabled]):not([tabindex="-1"])',
            ) ?? []),
          ];
          if (focusables.length === 0) return;
          const index = focusables.indexOf(document.activeElement as HTMLElement);
          const next = event.shiftKey
            ? focusables.at(index <= 0 ? -1 : index - 1)
            : focusables[index === -1 || index === focusables.length - 1 ? 0 : index + 1];
          next?.focus();
        } else if (event.key === 'Escape') onClose();
        else if (event.key === ' ' && flipRef.current) toggleShown();
        else if (event.key === '=' || event.key === '+') zoomCenter(STEP);
        else if (event.key === '-') zoomCenter(1 / STEP);
        else if (event.key === '0') reset();
        else return;
        // Capture phase on window runs first: keep Esc from also closing a
        // drawer or modal the card sits in.
        event.preventDefault();
        event.stopPropagation();
      };
      const { overflow } = document.body.style;
      document.body.style.overflow = 'hidden';
      // A focused button (the Before/After item just clicked) still fires its
      // click on Space keyup in Firefox, which would undo the flip.
      const onKeyUp = (event: KeyboardEvent) => {
        if (event.key === ' ' && flipRef.current) event.preventDefault();
      };
      window.addEventListener('keydown', onKeyDown, true);
      window.addEventListener('keyup', onKeyUp, true);
      closeRef.current?.focus();
      return () => {
        window.removeEventListener('keydown', onKeyDown, true);
        window.removeEventListener('keyup', onKeyUp, true);
        document.body.style.overflow = overflow;
        opener?.focus?.();
      };
    }, [onClose, reset, returnFocusRef, toggleShown, zoomCenter]);

    const transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;

    return createPortal(
      <div
        aria-modal
        aria-label={t('report.evidence.comparison.fullscreen')}
        ref={dialogRef}
        role={'dialog'}
        {...stylex.props(styles.overlay)}
      >
        <Flexbox
          horizontal
          align={'center'}
          gap={12}
          justify={'flex-end'}
          {...stylex.props(styles.bar)}
        >
          <Segmented
            size={'small'}
            value={mode}
            options={[
              { label: t('report.evidence.comparison.modeSide'), value: 'side' },
              { label: t('report.evidence.comparison.modeFlip'), value: 'flip' },
            ]}
            onChange={(value) => changeMode(value as ComparisonMode)}
          />
          {flip && (
            <Tooltip title={t('report.evidence.comparison.flipHint')}>
              <Segmented
                size={'small'}
                value={shown}
                options={[
                  { label: t('report.evidence.comparison.before'), value: 'before' },
                  { label: t('report.evidence.comparison.after'), value: 'after' },
                ]}
                onChange={(value) => setShown(value as ComparisonRole)}
              />
            </Tooltip>
          )}
          <Flexbox flex={1} />
          <Text fontSize={12} type={'secondary'}>
            {t('report.evidence.comparison.zoomHint')}
          </Text>
          <Flexbox horizontal align={'center'} {...stylex.props(styles.zoomBox)}>
            <ActionIcon
              aria-label={t('report.evidence.comparison.zoomOut')}
              disabled={view.scale <= MIN_SCALE}
              icon={Minus}
              size={'small'}
              title={t('report.evidence.comparison.zoomOut')}
              onClick={() => zoomCenter(1 / STEP)}
            />
            <Tooltip title={t('report.evidence.comparison.zoomReset')}>
              <button
                aria-label={t('report.evidence.comparison.zoomReset')}
                type={'button'}
                {...stylex.props(styles.zoomValue)}
                onClick={reset}
              >
                {Math.round(view.scale * 100)}%
              </button>
            </Tooltip>
            <ActionIcon
              aria-label={t('report.evidence.comparison.zoomIn')}
              disabled={view.scale >= MAX_SCALE}
              icon={Plus}
              size={'small'}
              title={t('report.evidence.comparison.zoomIn')}
              onClick={() => zoomCenter(STEP)}
            />
          </Flexbox>
          <ActionIcon
            aria-label={t('report.evidence.comparison.exitFullscreen')}
            icon={X}
            ref={closeRef}
            title={t('report.evidence.comparison.exitFullscreen')}
            onClick={onClose}
          />
        </Flexbox>
        {flip ? (
          <div {...stylex.props(styles.stage, styles.stageSingle)}>
            <div {...stylex.props(styles.side)}>
              {shown === 'before' ? before.band : after.band}
              <div
                ref={bindPane(0)}
                {...stylex.props(styles.pane, view.scale > MIN_SCALE && styles.paneZoomed)}
              >
                {/* Both stay mounted and loaded, so a flip swaps pixels in place
                    with no reload flash, and the shared bounds still see both. */}
                {[before, after].map((side, index) => (
                  <div
                    aria-hidden={(index === 0 ? 'before' : 'after') !== shown}
                    key={index}
                    {...sx(
                      styles.content,
                      (index === 0 ? 'before' : 'after') !== shown && styles.contentHidden,
                      { transform },
                    )}
                  >
                    <img
                      alt={side.alt}
                      draggable={false}
                      ref={bindImage(index)}
                      src={side.src}
                      {...stylex.props(styles.image)}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div {...stylex.props(styles.stage, layout === 'vertical' && styles.stageVertical)}>
            {[before, after].map((side, index) => (
              <div
                key={index}
                {...stylex.props(
                  styles.side,
                  layout === 'vertical' && index === 1 && styles.sideStackedAfter,
                )}
              >
                {side.band}
                <div
                  ref={bindPane(index)}
                  {...stylex.props(styles.pane, view.scale > MIN_SCALE && styles.paneZoomed)}
                >
                  <div {...sx(styles.content, { transform })}>
                    <img
                      alt={side.alt}
                      draggable={false}
                      ref={bindImage(index)}
                      src={side.src}
                      {...stylex.props(styles.image)}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>,
      document.body,
    );
  },
);

EvidenceComparisonFullscreen.displayName = 'EvidenceComparisonFullscreen';

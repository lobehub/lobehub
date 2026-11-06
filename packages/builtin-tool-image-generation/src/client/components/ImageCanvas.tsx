'use client';

import { Image } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import type { CSSProperties, ReactNode } from 'react';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { sx } from '@/styles/sx';

import { useDevelopsOnMount } from './useDevelopsOnMount';

// Three colour blobs wander on independent, co-prime loops so the aura never
// visibly repeats.
const wanderA = stylex.keyframes({
  '0%, 100%': { transform: 'translate(-18%, -12%) scale(1)' },
  '50%': { transform: 'translate(22%, 16%) scale(1.25)' },
});

const wanderB = stylex.keyframes({
  '0%, 100%': { transform: 'translate(20%, -16%) scale(1.15)' },
  '50%': { transform: 'translate(-16%, 20%) scale(0.9)' },
});

const wanderC = stylex.keyframes({
  '0%, 100%': { transform: 'translate(0, 24%) scale(0.95)' },
  '50%': { transform: 'translate(-6%, -22%) scale(1.2)' },
});

// The whole aura keeps reaching for focus and slipping back — the canvas reads
// as a picture trying to resolve, not as a spinner. Transform and opacity only:
// animating a filter would repaint the whole canvas every frame.
const focus = stylex.keyframes({
  '0%, 100%': { opacity: 0.8, transform: 'scale(1.1)' },
  '50%': { opacity: 1, transform: 'scale(0.94)' },
});

// The finished image comes out of the same blur the aura lives in, so waiting
// and reveal are one continuous motion. Keyframes rather than a transition: a
// cached image fires onLoad before the hidden state is painted, and a
// transition would then skip straight to the end.
const develop = stylex.keyframes({
  from: { opacity: 0, filter: 'blur(28px) saturate(1.4)', transform: 'scale(1.04)' },
  to: { opacity: 1, filter: 'blur(0) saturate(1)', transform: 'scale(1)' },
});

// Fine film grain over the aura, so the blur reads as an emulsion developing
// rather than a flat CSS gradient.
const GRAIN = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`;

const REDUCED_MOTION = '@media (prefers-reduced-motion: reduce)';

const styles = stylex.create({
  animationStill: {
    animationDelay: '0s',
    animationDuration: '0s',
    animationIterationCount: 1,
    animationName: 'none',
    animationTimingFunction: 'ease',
  },
  aura: {
    position: 'absolute',
    inset: 0,
    transitionProperty: 'opacity',
    transitionDuration: '700ms',
    transitionTimingFunction: 'ease',
  },
  auraFocus: {
    willChange: 'transform, opacity',
    position: 'absolute',
    inset: '-20%',
    animationName: { default: focus, [REDUCED_MOTION]: 'none' },
    animationDuration: { default: '4.2s', [REDUCED_MOTION]: '0s' },
    animationTimingFunction: { default: 'ease-in-out', [REDUCED_MOTION]: 'ease' },
    animationIterationCount: { default: 'infinite', [REDUCED_MOTION]: 1 },
    animationDelay: { default: 'var(--aura-delay, 0s)', [REDUCED_MOTION]: '0s' },
  },
  auraHidden: {
    opacity: 0,
  },
  auraStill: {
    opacity: 0.45,
    filter: 'grayscale(1)',
  },
  badge: {
    position: 'absolute',
    zIndex: 2,
    insetBlockEnd: '12px',
    insetInlineEnd: '12px',
    paddingBlock: '3px',
    paddingInline: '10px',
    borderRadius: '999px',
    fontSize: '12px',
    fontVariantNumeric: 'tabular-nums',
    color: cssVar.colorTextSecondary,
    backgroundColor: `color-mix(in srgb, ${cssVar.colorBgElevated} 72%, transparent)`,
    backgroundImage: 'none',
    backdropFilter: 'blur(8px)',
  },
  blob: {
    position: 'absolute',
    insetBlockStart: '10%',
    insetInlineStart: '10%',
    width: '80%',
    aspectRatio: 1,
    borderRadius: '50%',
    opacity: 0.75,
    willChange: 'transform',
  },
  // Soft falloff baked into the gradient, so no blur filter is needed; an eased ramp,
  // because linear stops leave a visible rim once there is no blur.
  blobA: {
    backgroundImage:
      'radial-gradient(circle closest-side, var(--aura-a) 0%, color-mix(in srgb, var(--aura-a) 78%, transparent) 18%, color-mix(in srgb, var(--aura-a) 52%, transparent) 36%, color-mix(in srgb, var(--aura-a) 28%, transparent) 54%, color-mix(in srgb, var(--aura-a) 11%, transparent) 72%, color-mix(in srgb, var(--aura-a) 3%, transparent) 88%, transparent 100%)',
    animationName: { default: wanderA, [REDUCED_MOTION]: 'none' },
    animationDuration: { default: '9s', [REDUCED_MOTION]: '0s' },
    animationTimingFunction: { default: 'ease-in-out', [REDUCED_MOTION]: 'ease' },
    animationIterationCount: { default: 'infinite', [REDUCED_MOTION]: 1 },
    animationDelay: { default: 'var(--aura-delay, 0s)', [REDUCED_MOTION]: '0s' },
  },
  blobB: {
    backgroundImage:
      'radial-gradient(circle closest-side, var(--aura-b) 0%, color-mix(in srgb, var(--aura-b) 78%, transparent) 18%, color-mix(in srgb, var(--aura-b) 52%, transparent) 36%, color-mix(in srgb, var(--aura-b) 28%, transparent) 54%, color-mix(in srgb, var(--aura-b) 11%, transparent) 72%, color-mix(in srgb, var(--aura-b) 3%, transparent) 88%, transparent 100%)',
    animationName: { default: wanderB, [REDUCED_MOTION]: 'none' },
    animationDuration: { default: '11s', [REDUCED_MOTION]: '0s' },
    animationTimingFunction: { default: 'ease-in-out', [REDUCED_MOTION]: 'ease' },
    animationIterationCount: { default: 'infinite', [REDUCED_MOTION]: 1 },
    animationDelay: { default: 'var(--aura-delay, 0s)', [REDUCED_MOTION]: '0s' },
  },
  blobC: {
    backgroundImage:
      'radial-gradient(circle closest-side, var(--aura-c) 0%, color-mix(in srgb, var(--aura-c) 78%, transparent) 18%, color-mix(in srgb, var(--aura-c) 52%, transparent) 36%, color-mix(in srgb, var(--aura-c) 28%, transparent) 54%, color-mix(in srgb, var(--aura-c) 11%, transparent) 72%, color-mix(in srgb, var(--aura-c) 3%, transparent) 88%, transparent 100%)',
    animationName: { default: wanderC, [REDUCED_MOTION]: 'none' },
    animationDuration: { default: '13s', [REDUCED_MOTION]: '0s' },
    animationTimingFunction: { default: 'ease-in-out', [REDUCED_MOTION]: 'ease' },
    animationIterationCount: { default: 'infinite', [REDUCED_MOTION]: 1 },
    animationDelay: { default: 'var(--aura-delay, 0s)', [REDUCED_MOTION]: '0s' },
  },
  canvas: {
    position: 'relative',
    overflow: 'hidden',
    width: '100%',
    borderRadius: '12px',
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  grain: {
    position: 'absolute',
    inset: 0,
    opacity: 0.16,
    backgroundImage: GRAIN,
    backgroundSize: '160px 160px',
    mixBlendMode: 'overlay',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  layer: {
    position: 'absolute',
    inset: 0,
  },
  overlay: {
    position: 'absolute',
    zIndex: 1,
    inset: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    alignItems: 'center',
    justifyContent: 'center',
    paddingBlock: '16px',
    paddingInline: '16px',
    textAlign: 'center',
  },
  reveal: {
    position: 'absolute',
    zIndex: 1,
    inset: 0,
    opacity: 0,
  },
  revealed: {
    opacity: 1,
  },
  revealedDevelop: {
    opacity: 1,
    animationName: { default: develop, [REDUCED_MOTION]: 'none' },
    animationDuration: { default: '1100ms', [REDUCED_MOTION]: '0s' },
    animationTimingFunction: { default: 'cubic-bezier(0.2, 0, 0, 1)', [REDUCED_MOTION]: 'ease' },
    animationFillMode: { default: 'both', [REDUCED_MOTION]: 'none' },
  },
});

// Tiles in one grid rotate through the palette instead of hue-rotating a filter,
// which would have to be re-applied on every animation frame.
const AURA_PALETTE = [cssVar.purple, cssVar.geekblue, cssVar.cyan, cssVar.magenta];

// A negative delay of "time since generation started" puts every loop at the
// phase it would have reached, so the aura does not jump back to its first frame
// when the streaming canvas is swapped for the result canvas.
const auraStyle = (seed: number, startedAt?: number) =>
  ({
    '--aura-a': AURA_PALETTE[seed % AURA_PALETTE.length],
    '--aura-b': AURA_PALETTE[(seed + 1) % AURA_PALETTE.length],
    '--aura-c': AURA_PALETTE[(seed + 2) % AURA_PALETTE.length],
    '--aura-delay': startedAt ? `${-Math.max(0, Date.now() - startedAt) / 1000}s` : '0s',
  }) as CSSProperties;

const useElapsedSeconds = (startedAt?: number) => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!startedAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);

  return startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : undefined;
};

export interface ImageCanvasProps {
  alt?: string;
  /**
   * Status pill pinned to the bottom-right corner while the image is in flight.
   */
  badge?: string;
  /**
   * Centered content for non-image end states (error message, retry button).
   * Freezes and desaturates the aura — nothing is being generated any more.
   */
  children?: ReactNode;
  onDownload?: (source: string) => void | Promise<void>;
  /**
   * width / height
   */
  ratio?: number;
  /**
   * Varies the aura hue, so tiles in one grid don't look cloned.
   */
  seed?: number;
  /**
   * When generation started (ms epoch). Appends honest elapsed time to the
   * badge; omitted when the real start is unknown.
   */
  startedAt?: number;
  url?: string;
}

/**
 * One image slot. It is the same element before and after the image exists:
 * a drifting, grainy colour aura that keeps reaching for focus while
 * generating, then the image develops out of that blur — so the chat never
 * jumps when the result lands.
 */
export const ImageCanvas = memo<ImageCanvasProps>(
  ({ alt, badge, children, onDownload, ratio = 1, seed = 0, startedAt, url }) => {
    const { t } = useTranslation('plugin');
    const [loadedUrl, setLoadedUrl] = useState<string>();
    const loaded = !!url && loadedUrl === url;
    const develops = useDevelopsOnMount(url, startedAt);
    const generating = !url && !children;
    const elapsed = useElapsedSeconds(generating ? startedAt : undefined);
    // Computed once per mount: recomputing on every re-render would restart the loops.
    const [auraLayerStyle] = useState(() => auraStyle(seed, startedAt));

    const badgeText =
      badge && elapsed !== undefined
        ? t('builtins.lobe-image-generation.render.status.elapsed', {
            seconds: elapsed,
            status: badge,
          })
        : badge;

    return (
      <div {...sx(styles.canvas, undefined, { aspectRatio: ratio })}>
        {develops && (
          <div
            aria-hidden
            {...stylex.props(
              styles.aura,
              loaded && styles.auraHidden,
              !!children && styles.auraStill,
            )}
          >
            <div {...sx(styles.layer, undefined, auraLayerStyle)}>
              <div {...stylex.props(styles.auraFocus, !!children && styles.animationStill)}>
                <span
                  {...stylex.props(styles.blob, styles.blobA, !!children && styles.animationStill)}
                />
                <span
                  {...stylex.props(styles.blob, styles.blobB, !!children && styles.animationStill)}
                />
                <span
                  {...stylex.props(styles.blob, styles.blobC, !!children && styles.animationStill)}
                />
              </div>
            </div>
            <div {...stylex.props(styles.grain)} />
          </div>
        )}
        {url && (
          <div
            {...stylex.props(
              styles.reveal,
              develops ? loaded && styles.revealedDevelop : styles.revealed,
            )}
          >
            <Image
              alt={alt}
              className={stylex.props(styles.image).className}
              height={'100%'}
              objectFit={'cover'}
              preview={onDownload ? { onDownload } : true}
              src={url}
              variant={'borderless'}
              width={'100%'}
              classNames={{
                image: stylex.props(styles.image).className,
                wrapper: stylex.props(styles.image).className,
              }}
              onError={() => setLoadedUrl(url)}
              onLoad={() => setLoadedUrl(url)}
            />
          </div>
        )}
        {!url && children && <div {...stylex.props(styles.overlay)}>{children}</div>}
        {generating && badgeText && <span {...stylex.props(styles.badge)}>{badgeText}</span>}
      </div>
    );
  },
);

ImageCanvas.displayName = 'ImageCanvas';

export default ImageCanvas;

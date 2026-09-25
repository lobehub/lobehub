'use client';

import { Image } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx, keyframes } from 'antd-style';
import type { CSSProperties, ReactNode } from 'react';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

// Three colour blobs wander on independent, co-prime loops so the aura never
// visibly repeats.
const wanderA = keyframes`
  0%, 100% { transform: translate(-18%, -12%) scale(1); }
  50% { transform: translate(22%, 16%) scale(1.25); }
`;

const wanderB = keyframes`
  0%, 100% { transform: translate(20%, -16%) scale(1.15); }
  50% { transform: translate(-16%, 20%) scale(0.9); }
`;

const wanderC = keyframes`
  0%, 100% { transform: translate(0, 24%) scale(0.95); }
  50% { transform: translate(-6%, -22%) scale(1.2); }
`;

// The whole aura keeps reaching for focus and slipping back — the canvas reads
// as a picture trying to resolve, not as a spinner. Transform and opacity only:
// animating a filter would repaint the whole canvas every frame.
const focus = keyframes`
  0%, 100% { opacity: 0.8; transform: scale(1.1); }
  50% { opacity: 1; transform: scale(0.94); }
`;

// The finished image comes out of the same blur the aura lives in, so waiting
// and reveal are one continuous motion. Keyframes rather than a transition: a
// cached image fires onLoad before the hidden state is painted, and a
// transition would then skip straight to the end.
const develop = keyframes`
  from { opacity: 0; filter: blur(28px) saturate(1.4); transform: scale(1.04); }
  to { opacity: 1; filter: blur(0) saturate(1); transform: scale(1); }
`;

// Fine film grain over the aura, so the blur reads as an emulsion developing
// rather than a flat CSS gradient.
const GRAIN = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`;

const blob = `
  position: absolute;
  inset-block-start: 10%;
  inset-inline-start: 10%;

  width: 80%;
  aspect-ratio: 1;
  border-radius: 50%;

  opacity: 0.75;
  will-change: transform;

  @media (prefers-reduced-motion: reduce) {
    animation: none !important;
  }
`;

// Soft falloff baked into the gradient, so no blur filter is needed.
const glow = (color: string) => {
  // An eased ramp: linear stops leave a visible rim once there is no blur.
  const mix = (percent: number) => `color-mix(in srgb, ${color} ${percent}%, transparent)`;
  return `radial-gradient(circle closest-side, ${color} 0%, ${mix(78)} 18%, ${mix(52)} 36%, ${mix(28)} 54%, ${mix(11)} 72%, ${mix(3)} 88%, transparent 100%)`;
};

const styles = createStaticStyles(({ css, cssVar }) => ({
  aura: css`
    position: absolute;
    inset: 0;
    transition: opacity 700ms ease;
  `,
  auraFocus: css`
    will-change: transform, opacity;

    position: absolute;
    inset: -20%;

    animation: ${focus} 4.2s ease-in-out infinite;
    animation-delay: var(--aura-delay, 0s);

    @media (prefers-reduced-motion: reduce) {
      animation: none;
    }
  `,
  auraHidden: css`
    opacity: 0;
  `,
  auraStill: css`
    opacity: 0.45;
    filter: grayscale(1);

    * {
      animation: none !important;
    }
  `,
  badge: css`
    position: absolute;
    z-index: 2;
    inset-block-end: 12px;
    inset-inline-end: 12px;

    padding-block: 3px;
    padding-inline: 10px;
    border-radius: 999px;

    font-size: 12px;
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorTextSecondary};

    background: color-mix(in srgb, ${cssVar.colorBgElevated} 72%, transparent);
    backdrop-filter: blur(8px);
  `,
  blobA: css`
    ${blob}
    background: ${glow('var(--aura-a)')};
    animation: ${wanderA} 9s ease-in-out infinite;
    animation-delay: var(--aura-delay, 0s);
  `,
  blobB: css`
    ${blob}
    background: ${glow('var(--aura-b)')};
    animation: ${wanderB} 11s ease-in-out infinite;
    animation-delay: var(--aura-delay, 0s);
  `,
  blobC: css`
    ${blob}
    background: ${glow('var(--aura-c)')};
    animation: ${wanderC} 13s ease-in-out infinite;
    animation-delay: var(--aura-delay, 0s);
  `,
  canvas: css`
    position: relative;

    overflow: hidden;

    width: 100%;
    border-radius: 12px;

    background: ${cssVar.colorFillQuaternary};
  `,
  grain: css`
    position: absolute;
    inset: 0;

    opacity: 0.16;
    background-image: ${GRAIN};
    background-size: 160px 160px;
    mix-blend-mode: overlay;
  `,
  image: css`
    width: 100%;
    height: 100%;
  `,
  layer: css`
    position: absolute;
    inset: 0;
  `,
  overlay: css`
    position: absolute;
    z-index: 1;
    inset: 0;

    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: center;
    justify-content: center;

    padding: 16px;

    text-align: center;
  `,
  reveal: css`
    position: absolute;
    z-index: 1;
    inset: 0;
    opacity: 0;
  `,
  revealed: css`
    opacity: 1;
    animation: ${develop} 1100ms cubic-bezier(0.2, 0, 0, 1) both;

    @media (prefers-reduced-motion: reduce) {
      animation: none;
    }
  `,
}));

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
      <div className={styles.canvas} style={{ aspectRatio: ratio }}>
        <div
          aria-hidden
          className={cx(styles.aura, loaded && styles.auraHidden, !!children && styles.auraStill)}
        >
          <div className={styles.layer} style={auraLayerStyle}>
            <div className={styles.auraFocus}>
              <span className={styles.blobA} />
              <span className={styles.blobB} />
              <span className={styles.blobC} />
            </div>
          </div>
          <div className={styles.grain} />
        </div>
        {url && (
          <div className={cx(styles.reveal, loaded && styles.revealed)}>
            <Image
              alt={alt}
              className={styles.image}
              classNames={{ image: styles.image, wrapper: styles.image }}
              height={'100%'}
              objectFit={'cover'}
              preview={onDownload ? { onDownload } : true}
              src={url}
              variant={'borderless'}
              width={'100%'}
              onError={() => setLoadedUrl(url)}
              onLoad={() => setLoadedUrl(url)}
            />
          </div>
        )}
        {!url && children && <div className={styles.overlay}>{children}</div>}
        {generating && badgeText && <span className={styles.badge}>{badgeText}</span>}
      </div>
    );
  },
);

ImageCanvas.displayName = 'ImageCanvas';

export default ImageCanvas;

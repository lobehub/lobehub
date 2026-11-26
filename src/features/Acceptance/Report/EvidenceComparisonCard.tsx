'use client';

import {
  ActionIcon,
  // oxlint-disable-next-line stylex-migration/no-emotion-styles -- media inside markdown, document and video evidence renderers
  createStaticStyles,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Maximize2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { memo, useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { sx } from '@/styles/sx';

import { EvidenceComparisonFullscreen } from './EvidenceComparisonFullscreen';

/** The `metadata.comparison` an evidence artifact may carry (authored at ingest). */
export interface EvidenceComparisonMeta {
  id: string;
  /** Optional authored caption shown in the tinted band. */
  label?: string;
  /**
   * How the pair is arranged. Side by side reads best for tall, narrow captures
   * (a sidebar, a form); stacking is the only way a wide, short strip (a toolbar,
   * a one-line footer) stays legible, since two of them side by side halve an
   * already-thin band. Authors pick per pair; defaults to side by side.
   */
  layout: 'horizontal' | 'vertical';
  role: 'after' | 'before';
}

const toRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/** A bare filename is not a caption — only descriptive prose reads on the band. */
export const isFilenameLike = (value?: string | null) =>
  !value ||
  /^[\w.-]+\.(?:gif|html?|jpe?g|json|log|markdown|md|mp4|png|txt|webm|webp)$/i.test(value);

/** Keep authored context, but suppress generated filenames and duplicated labels. */
export const meaningfulEvidenceCaption = (
  description?: string | null,
  label?: string | null,
): string | null =>
  description && description !== label && !isFilenameLike(description) ? description : null;

/** Parse an evidence row's `metadata.comparison`, or null when it carries none. */
export const readEvidenceComparison = (metadata: unknown): EvidenceComparisonMeta | null => {
  const record = toRecord(metadata);
  const comparison = toRecord(record?.comparison);
  if (!comparison) return null;

  const role = comparison.role;
  if (typeof comparison.id !== 'string' || (role !== 'before' && role !== 'after')) return null;

  return {
    id: comparison.id,
    label: typeof comparison.label === 'string' ? comparison.label : undefined,
    layout: comparison.layout === 'vertical' ? 'vertical' : 'horizontal',
    role,
  };
};

const styles = stylex.create({
  /* One fused card: the pair is a single object, so no outer gap between the
     halves — the 1px background seam is the divider in either direction, which
     keeps the split correct when the grid collapses to one column. */
  card: {
    position: 'relative',
    overflow: 'hidden',
    display: 'grid',
    gridTemplateColumns: {
      'default': 'repeat(2, minmax(0, 1fr))',
      '@media (width <= 640px)': '1fr',
    },
    gap: '1px',
    width: '100%',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadius,
    backgroundColor: cssVar.colorBorderSecondary,
    backgroundImage: 'none',
  },
  cardVertical: { gridTemplateColumns: '1fr' },
  side: {
    display: 'flex',
    flexDirection: 'column',
    minWidth: '0',
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  /* The role rides on a tinted band fused to its own capture, so which state
     you're looking at survives being read at a glance. */
  label: {
    display: 'flex',
    gap: '8px',
    alignItems: 'baseline',
    paddingBlock: '7px',
    paddingInline: '10px',
    fontSize: '12px',
  },
  labelBefore: {
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorErrorBorder,
    color: cssVar.colorErrorText,
    backgroundColor: cssVar.colorErrorBg,
    backgroundImage: 'none',
  },
  labelAfter: {
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorSuccessBorder,
    color: cssVar.colorSuccessText,
    backgroundColor: cssVar.colorSuccessBg,
    backgroundImage: 'none',
  },
  /* The two captions are themselves a before/after contrast, so they must stay
     readable side by side — wrap rather than ellipsize. */
  caption: { minWidth: '0', opacity: 0.85 },
  /* Room for the full-screen button in the card's top-right corner. Either band
     can sit there (after when side by side, before when stacked or on a phone). */
  labelWithAction: { paddingInlineEnd: '40px' },
  fullscreenButton: {
    position: 'absolute',
    zIndex: 1,
    insetBlockStart: '4px',
    insetInlineEnd: '6px',
  },
  /* With no caption band the button lies on the picture, so it needs its own surface. */
  fullscreenButtonFloating: {
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    backgroundColor: cssVar.colorBgElevated,
    backgroundImage: 'none',
    boxShadow: cssVar.boxShadowTertiary,
  },
  content: { flex: '1', minWidth: '0' },
});

const fallback = createStaticStyles(({ css }) => ({
  content: css`
    img,
    video {
      display: block;
      width: 100%;
      border: none !important;
      border-radius: 0 !important;
    }
  `,
}));

const comparisonMediaStyles = stylex.create({
  image: {
    display: 'block',
    width: '100%',
    borderWidth: 'medium',
    borderStyle: 'none',
    borderColor: 'currentcolor',
    borderRadius: 0,
  },
  video: {
    display: 'block',
    width: '100%',
    borderWidth: 'medium',
    borderStyle: 'none',
    borderColor: 'currentcolor',
    borderRadius: 0,
  },
});

export const comparisonMedia = {
  image: {
    classNames: { image: stylex.props(comparisonMediaStyles.image).className },
    variant: 'borderless' as const,
  },
  video: comparisonMediaStyles.video,
};

export interface EvidenceComparisonSide {
  /** Caption in the tinted band — the comparison label, or the evidence description. */
  caption?: string;
  content: ReactNode;
  /**
   * The full image URL when this side is a picture (screenshot / gif). When both
   * sides have one, the card offers a full-screen, synced-zoom comparison.
   */
  imageSrc?: string;
}

interface EvidenceComparisonCardProps {
  after: EvidenceComparisonSide;
  before: EvidenceComparisonSide;
  layout?: 'horizontal' | 'vertical';
}

/**
 * The fused before/after card shared by the verify report and the acceptance
 * union — one implementation so the two surfaces can't drift apart.
 */
const ComparisonBand = ({
  caption,
  role,
  withAction,
}: {
  caption: string;
  role: 'after' | 'before';
  withAction?: boolean;
}) => (
  <div
    {...stylex.props(
      styles.label,
      role === 'before' ? styles.labelBefore : styles.labelAfter,
      withAction && styles.labelWithAction,
    )}
  >
    <span {...stylex.props(styles.caption)}>{caption}</span>
  </div>
);

/**
 * The fused before/after card shared by the verify report and the acceptance
 * union — one implementation so the two surfaces can't drift apart.
 */
export const EvidenceComparisonCard = memo<EvidenceComparisonCardProps>(
  ({ after, before, layout = 'horizontal' }) => {
    const { t } = useTranslation('verify');
    const cardRef = useRef<HTMLDivElement>(null);
    const [fullscreen, setFullscreen] = useState(false);
    const closeFullscreen = useCallback(() => setFullscreen(false), []);
    const canFullscreen = Boolean(before.imageSrc && after.imageSrc);
    const sides = [
      ['before', before],
      ['after', after],
    ] as const;

    return (
      <div
        ref={cardRef}
        tabIndex={-1}
        {...stylex.props(styles.card, layout === 'vertical' && styles.cardVertical)}
      >
        {canFullscreen && (
          <ActionIcon
            aria-label={t('report.evidence.comparison.fullscreen')}
            icon={Maximize2}
            size={'small'}
            title={t('report.evidence.comparison.fullscreen')}
            {...stylex.props(
              styles.fullscreenButton,
              !(before.caption && after.caption) && styles.fullscreenButtonFloating,
            )}
            onClick={() => setFullscreen(true)}
          />
        )}
        {sides.map(([role, side]) => (
          <div {...stylex.props(styles.side)} key={role}>
            {side.caption && (
              <ComparisonBand caption={side.caption} role={role} withAction={canFullscreen} />
            )}
            <div {...sx(styles.content, fallback.content)}>{side.content}</div>
          </div>
        ))}
        {fullscreen && (
          <EvidenceComparisonFullscreen
            layout={layout}
            returnFocusRef={cardRef}
            after={{
              alt: after.caption ?? t('report.evidence.comparison.after'),
              band: after.caption && <ComparisonBand caption={after.caption} role={'after'} />,
              src: after.imageSrc!,
            }}
            before={{
              alt: before.caption ?? t('report.evidence.comparison.before'),
              band: before.caption && <ComparisonBand caption={before.caption} role={'before'} />,
              src: before.imageSrc!,
            }}
            onClose={closeFullscreen}
          />
        )}
      </div>
    );
  },
);

EvidenceComparisonCard.displayName = 'EvidenceComparisonCard';

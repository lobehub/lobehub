'use client';

import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';
import { memo } from 'react';

import { sx } from '@/styles/sx';

import contentStyles from './EvidenceComparisonCard.module.css';

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
  /* The card frames the capture; an inner border/radius would double the frame,
     so whatever media the caller renders inside is flattened to the card edge
     (plain CSS module: StyleX has no descendant tag selectors). */
  content: { flex: '1', minWidth: '0' },
});

export interface EvidenceComparisonSide {
  /** Caption in the tinted band — the comparison label, or the evidence description. */
  caption?: string;
  content: ReactNode;
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
export const EvidenceComparisonCard = memo<EvidenceComparisonCardProps>(
  ({ after, before, layout = 'horizontal' }) => {
    return (
      <div {...stylex.props(styles.card, layout === 'vertical' && styles.cardVertical)}>
        {(
          [
            ['before', before],
            ['after', after],
          ] as const
        ).map(([role, side]) => (
          <div {...stylex.props(styles.side)} key={role}>
            {side.caption && (
              <div
                {...stylex.props(
                  styles.label,
                  role === 'before' ? styles.labelBefore : styles.labelAfter,
                )}
              >
                <span {...stylex.props(styles.caption)}>{side.caption}</span>
              </div>
            )}
            <div {...sx([styles.content], contentStyles.content)}>{side.content}</div>
          </div>
        ))}
      </div>
    );
  },
);

EvidenceComparisonCard.displayName = 'EvidenceComparisonCard';

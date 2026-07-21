'use client';

import { createStaticStyles, cssVar, cx } from 'antd-style';
import type { ReactNode } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

/** The `metadata.comparison` an evidence artifact may carry (authored at ingest). */
export interface EvidenceComparisonMeta {
  id: string;
  /** Optional per-side caption shown next to the role. */
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
  !value || /^[\w.-]+\.(?:gif|jpe?g|mp4|png|webm|webp)$/i.test(value);

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

const styles = createStaticStyles(({ css }) => ({
  /* One fused card: the pair is a single object, so no outer gap between the
     halves — the 1px background seam is the divider in either direction, which
     keeps the split correct when the grid collapses to one column. */
  card: css`
    overflow: hidden;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1px;

    width: 100%;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};

    background: ${cssVar.colorBorderSecondary};

    @media (width <= 640px) {
      grid-template-columns: 1fr;
    }
  `,
  cardVertical: css`
    grid-template-columns: 1fr;
  `,
  side: css`
    display: flex;
    flex-direction: column;
    min-width: 0;
    background: ${cssVar.colorBgContainer};
  `,
  /* The role rides on a tinted band fused to its own capture, so which state
     you're looking at survives being read at a glance. */
  label: css`
    display: flex;
    gap: 8px;
    align-items: baseline;

    padding-block: 7px;
    padding-inline: 10px;

    font-size: 12px;
  `,
  labelBefore: css`
    border-block-end: 1px solid ${cssVar.colorErrorBorder};
    color: ${cssVar.colorErrorText};
    background: ${cssVar.colorErrorBg};
  `,
  labelAfter: css`
    border-block-end: 1px solid ${cssVar.colorSuccessBorder};
    color: ${cssVar.colorSuccessText};
    background: ${cssVar.colorSuccessBg};
  `,
  role: css`
    flex: none;
    font-weight: 600;
  `,
  /* The two captions are themselves a before/after contrast, so they must stay
     readable side by side — wrap rather than ellipsize. */
  caption: css`
    min-width: 0;
    opacity: 0.85;
  `,
  /* The card frames the capture; an inner border/radius would double the frame,
     so whatever media the caller renders inside is flattened to the card edge. */
  content: css`
    flex: 1;
    min-width: 0;

    img,
    video {
      display: block;
      width: 100%;
      border: none !important;
      border-radius: 0 !important;
    }
  `,
}));

export interface EvidenceComparisonSide {
  /** Caption next to the role band — the comparison label, or the evidence description. */
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
    const { t } = useTranslation('verify');

    return (
      <div className={cx(styles.card, layout === 'vertical' && styles.cardVertical)}>
        {(
          [
            ['before', before],
            ['after', after],
          ] as const
        ).map(([role, side]) => (
          <div className={styles.side} key={role}>
            <div
              className={cx(
                styles.label,
                role === 'before' ? styles.labelBefore : styles.labelAfter,
              )}
            >
              <span className={styles.role}>{t(`report.evidence.comparison.${role}`)}</span>
              {side.caption && <span className={styles.caption}>{side.caption}</span>}
            </div>
            <div className={styles.content}>{side.content}</div>
          </div>
        ))}
      </div>
    );
  },
);

EvidenceComparisonCard.displayName = 'EvidenceComparisonCard';

import { createStaticStyles } from 'antd-style';

/**
 * Shared chip styles used by every Agent Documents inspector.
 *
 * Inlining these in each inspector means changing the visual language
 * touches 9 files; keeping one source of truth keeps the toolset coherent
 * (e.g. the doc-id chip should look the same whether you Read or Rename).
 */
export const inspectorChipStyles = createStaticStyles(({ css, cssVar }) => ({
  /** Highlighted chip for the primary subject (title, new title, etc.) */
  chip: css`
    overflow: hidden;
    display: inline-flex;
    flex-shrink: 1;
    align-items: center;

    min-width: 0;
    max-width: 280px;
    padding-block: 2px;
    padding-inline: 8px;
    border-radius: 999px;

    font-size: 12px;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;

    background: ${cssVar.colorFillTertiary};
  `,
  /** Compact, code-styled chip for raw identifiers */
  idChip: css`
    flex-shrink: 0;

    padding-block: 2px;
    padding-inline: 8px;
    border-radius: 999px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillTertiary};
  `,
  /** Inline middot used between segments */
  separator: css`
    flex-shrink: 0;
    color: ${cssVar.colorTextQuaternary};
  `,
  /** Secondary, lower-contrast chip for metadata (counts, target scope, …) */
  subdued: css`
    flex-shrink: 0;
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
}));

const UUID_LIKE = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

/**
 * Render a friendly short label for a document id. Full UUIDs are noisy in a
 * one-line header; their first 8 chars are unique enough for cross-referencing
 * within a single conversation. Prefixed ids (e.g. `agd_…`) are left intact —
 * they're already short and meaningful.
 */
export const formatDocumentId = (id?: string): string | undefined => {
  if (!id) return undefined;
  return UUID_LIKE.test(id) ? id.slice(0, 8) : id;
};

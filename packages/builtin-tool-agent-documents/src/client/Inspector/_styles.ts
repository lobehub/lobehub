import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

export const inspectorChipStyles = stylex.create({
  chip: {
    overflow: 'hidden',
    display: 'inline-flex',
    flexShrink: 1,
    alignItems: 'center',
    minWidth: 0,
    maxWidth: '280px',
    paddingBlock: '2px',
    paddingInline: '8px',
    borderRadius: '999px',
    fontSize: '12px',
    color: cssVar.colorText,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    backgroundColor: cssVar.colorFillTertiary,
    backgroundImage: 'none',
  },
  idChip: {
    flexShrink: 0,
    paddingBlock: '2px',
    paddingInline: '8px',
    borderRadius: '999px',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
    color: cssVar.colorTextSecondary,
    backgroundColor: cssVar.colorFillTertiary,
    backgroundImage: 'none',
  },
  separator: { flexShrink: 0, color: cssVar.colorTextQuaternary },
  subdued: { flexShrink: 0, fontSize: '12px', color: cssVar.colorTextTertiary },
});

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

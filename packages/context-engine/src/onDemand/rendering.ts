import type { OnDemandDynamicEntry } from '@lobechat/types';

export const ON_DEMAND_SUMMARY_CHAR_LIMIT = 96;

const escapeAttribute = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');

const escapeContent = (value: string): string =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

export const compactOnDemandSummary = (content: string): string => {
  const text = content
    .replaceAll(/<[^>]+>/g, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim();

  return [...text].slice(0, ON_DEMAND_SUMMARY_CHAR_LIMIT).join('');
};

/**
 * The exact envelope used when an entry is appended to the request. Budgeting
 * this rendered form (rather than the bare payload) prevents wrapper overhead
 * from pushing the assembled suffix past its configured ceiling.
 */
export const renderOnDemandContextMessageContent = (entry: OnDemandDynamicEntry): string =>
  [
    `<on_demand_context kind="${escapeAttribute(entry.kind)}" source="${escapeAttribute(
      entry.source.type,
    )}:${escapeAttribute(entry.source.id)}" provenance="${escapeAttribute(
      entry.provenance.contentHash,
    )}">`,
    entry.content,
    '</on_demand_context>',
  ].join('\n');

export const renderOnDemandSummaryContent = ({
  entry,
  reason,
  recoveryRef,
  summary,
}: {
  entry: OnDemandDynamicEntry;
  reason: string;
  recoveryRef: string;
  summary: string;
}): string =>
  [
    `<on_demand_summary kind="${escapeAttribute(entry.kind)}" original_hash="${escapeAttribute(
      entry.provenance.contentHash,
    )}" reason="${escapeAttribute(reason)}" recovery_ref="${escapeAttribute(recoveryRef)}">`,
    escapeContent(summary),
    '</on_demand_summary>',
  ].join('\n');

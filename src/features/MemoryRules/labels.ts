import { useTranslation } from 'react-i18next';

import type { RuleItem, RuleRevision, RuleScope } from '@/services/expertise';

export type RuleSectionKey = 'rule' | 'why' | 'how' | 'limits';

/** One section's text, or undefined when the rule has nothing under that heading. */
export const sectionBody = (rule: Pick<RuleItem, 'sections'>, key: RuleSectionKey) =>
  rule.sections?.find((section) => section.key === key)?.body?.trim() || undefined;

/**
 * The "when it does not apply" text after adding one more exception. Exceptions accumulate: the
 * composer adds a line, it never replaces what the reviewer already narrowed.
 */
/**
 * What distillation writes into `limits` when the reviewer drew no boundary (see the ingestion
 * prompt in `@lobechat/prompts`). It means "none yet", so the first real exception replaces it
 * rather than sitting under it — the same thing consolidation does.
 */
const UNSTATED_LIMITS = new Set(['边界未由评审者说明']);

export const appendException = (existing: string | undefined, exception: string) => {
  const next = exception.trim();
  const trimmed = existing?.trim();
  const current = trimmed && !UNSTATED_LIMITS.has(trimmed) ? trimmed : undefined;
  if (!current) return next;
  if (!next || current.split('\n').some((line) => line.trim() === next)) return current;
  return `${current}\n${next}`;
};

/** Where a rule went when it was archived by a merge, or null for a plain archive. */
export const mergedIntoId = (rule: Pick<RuleItem, 'rejectedReason'>) =>
  rule.rejectedReason?.startsWith('merged-into:')
    ? rule.rejectedReason.slice('merged-into:'.length)
    : null;

/**
 * Who made one edit. In a shared group any member can edit, so a human edit is "yours" only when
 * the reader made it.
 */
export const revisionAuthorKey = (revision: Pick<RuleRevision, 'byViewer' | 'changedBy'>) => {
  if (revision.changedBy !== 'user') return 'rules.revisions.bySystem' as const;
  return revision.byViewer
    ? ('rules.revisions.byYou' as const)
    : ('rules.revisions.byTeammate' as const);
};

/**
 * The sentence that says where a group takes effect, in the reader's language and with the
 * reader's list punctuation. Scopes with a deleted carrier still count; they just have no name.
 */
export const useScopeLabel = () => {
  const { i18n, t } = useTranslation('memory');
  const format = new Intl.ListFormat(i18n.language, { style: 'narrow', type: 'unit' });
  return (scopes: RuleScope[]) =>
    format.format(
      scopes.map((scope) => {
        switch (scope.kind) {
          case 'project': {
            return t('rules.scope.project', { title: scope.title ?? scope.id });
          }
          case 'agent': {
            return t('rules.scope.agent', { title: scope.title ?? scope.id });
          }
          case 'workspace': {
            return t('rules.scope.workspace');
          }
          default: {
            return t('rules.scope.user');
          }
        }
      }),
    );
};

/**
 * The single move a drag made, as "this rule now sits before that one" (or at the end). A drag
 * moves one row, so the rest of the order is implied and the request stays one id long.
 */
export const findMove = (
  previous: string[],
  next: string[],
): { beforeId: string | null; id: string } | null => {
  if (previous.length !== next.length || previous.every((id, index) => id === next[index])) {
    return null;
  }
  // The moved row is the one whose neighbours changed; try each candidate against the result.
  for (const id of next) {
    const rest = previous.filter((other) => other !== id);
    const at = next.indexOf(id);
    const rebuilt = [...rest.slice(0, at), id, ...rest.slice(at)];
    if (rebuilt.every((other, index) => other === next[index])) {
      return { beforeId: next[at + 1] ?? null, id };
    }
  }
  return null;
};

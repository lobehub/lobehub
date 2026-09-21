import { useTranslation } from 'react-i18next';

import type { RuleItem, RuleScope } from '@/services/expertise';

export type RuleSectionKey = 'rule' | 'why' | 'how' | 'limits';

/** One section's text, or undefined when the rule has nothing under that heading. */
export const sectionBody = (rule: Pick<RuleItem, 'sections'>, key: RuleSectionKey) =>
  rule.sections?.find((section) => section.key === key)?.body?.trim() || undefined;

/** Where a rule went when it was archived by a merge, or null for a plain archive. */
export const mergedIntoId = (rule: Pick<RuleItem, 'rejectedReason'>) =>
  rule.rejectedReason?.startsWith('merged-into:')
    ? rule.rejectedReason.slice('merged-into:'.length)
    : null;

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

import type { AgentDocument, AgentDocumentWithRules, DocumentLoadRules } from '../types';
import { DocumentLoadPosition, DocumentLoadRule } from '../types';

export const parseLoadRules = (
  doc: Pick<AgentDocument, 'policy' | 'policyLoadRule'>,
): DocumentLoadRules => {
  const context = doc.policy?.context || {};

  return {
    keywordMatchMode: context.keywordMatchMode,
    keywords: context.keywords,
    maxTokens: context.maxTokens,
    priority: context.priority,
    regexp: context.regexp,
    rule: (context.rule ?? doc.policyLoadRule ?? DocumentLoadRule.ALWAYS) as DocumentLoadRule,
    timeRange: context.timeRange,
  };
};

export const resolveDocumentLoadPosition = (
  doc: Pick<AgentDocument, 'policy' | 'policyLoadPosition'>,
): DocumentLoadPosition => {
  return (
    (doc.policy?.context?.position as DocumentLoadPosition | undefined) ||
    (doc.policyLoadPosition as DocumentLoadPosition | undefined) ||
    DocumentLoadPosition.BEFORE_FIRST_USER
  );
};

export const sortByLoadRulePriority = (
  docs: AgentDocumentWithRules[],
): AgentDocumentWithRules[] => {
  return [...docs].sort((a, b) => (a.loadRules?.priority ?? 999) - (b.loadRules?.priority ?? 999));
};

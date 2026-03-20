import type { AgentDocumentPolicy, DocumentLoadRules, ToolUpdateLoadRule } from '../types';
import { DocumentLoadFormat, DocumentLoadPosition, DocumentLoadRule, PolicyLoad } from '../types';

export const normalizePolicy = (
  loadPosition?: DocumentLoadPosition,
  loadRules?: DocumentLoadRules,
  policy?: AgentDocumentPolicy,
): AgentDocumentPolicy => {
  const contextPolicy = policy?.context || {};

  return {
    ...policy,
    context: {
      ...contextPolicy,
      keywordMatchMode: contextPolicy.keywordMatchMode ?? loadRules?.keywordMatchMode,
      keywords: contextPolicy.keywords ?? loadRules?.keywords,
      policyLoadFormat: contextPolicy.policyLoadFormat ?? DocumentLoadFormat.RAW,
      maxTokens: contextPolicy.maxTokens ?? loadRules?.maxTokens,
      position: contextPolicy.position ?? loadPosition ?? DocumentLoadPosition.BEFORE_FIRST_USER,
      priority: contextPolicy.priority ?? loadRules?.priority,
      regexp: contextPolicy.regexp ?? loadRules?.regexp,
      rule: contextPolicy.rule ?? loadRules?.rule ?? DocumentLoadRule.ALWAYS,
      timeRange: contextPolicy.timeRange ?? loadRules?.timeRange,
    },
  };
};

export interface ToolPolicyCompositionResult {
  policy: AgentDocumentPolicy;
  policyLoad: PolicyLoad;
  policyLoadFormat: DocumentLoadFormat;
  policyLoadRule: DocumentLoadRule;
}

export const composeToolPolicyUpdate = (
  existingPolicy: AgentDocumentPolicy | null,
  rule: ToolUpdateLoadRule,
): ToolPolicyCompositionResult => {
  const resolvePolicyLoadFormat = (format?: string): DocumentLoadFormat => {
    if (format === 'file') {
      return DocumentLoadFormat.FILE;
    }
    return DocumentLoadFormat.RAW;
  };

  const currentPolicy = existingPolicy || {};
  const existingContext = currentPolicy.context || {};
  const loadMode =
    rule.mode ?? (existingContext.loadMode as ToolUpdateLoadRule['mode']) ?? 'always';
  const policyLoadFormat = resolvePolicyLoadFormat(
    rule.policyLoadFormat ??
      (existingContext.policyLoadFormat as DocumentLoadFormat | undefined) ??
      DocumentLoadFormat.RAW,
  );
  const documentLoadRule = (rule.rule ??
    existingContext.rule ??
    DocumentLoadRule.ALWAYS) as DocumentLoadRule;

  const policy = {
    ...currentPolicy,
    context: {
      ...existingContext,
      loadMode,
      keywordMatchMode: rule.keywordMatchMode ?? existingContext.keywordMatchMode,
      keywords: rule.keywords ?? existingContext.keywords,
      policyLoadFormat,
      maxDocuments: rule.maxDocuments ?? existingContext.maxDocuments,
      maxTokens: rule.maxTokens ?? existingContext.maxTokens,
      pinnedDocumentIds: rule.pinnedDocumentIds ?? existingContext.pinnedDocumentIds,
      priority: rule.priority ?? existingContext.priority,
      regexp: rule.regexp ?? existingContext.regexp,
      rule: documentLoadRule,
      timeRange: rule.timeRange ?? existingContext.timeRange,
    },
  } satisfies AgentDocumentPolicy;

  return {
    policyLoad: loadMode === 'always' ? PolicyLoad.ALWAYS : PolicyLoad.DISABLED,
    policy,
    policyLoadFormat,
    policyLoadRule: documentLoadRule,
  };
};

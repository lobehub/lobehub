import { DocumentLoadRule } from '../types';

export type AgentDocumentLoadRule = 'always' | 'by-keywords' | 'by-regexp' | 'by-time-range';

export interface AgentDocumentLoadRules {
  keywordMatchMode?: 'all' | 'any';
  keywords?: string[];
  maxTokens?: number;
  priority?: number;
  regexp?: string;
  rule?: AgentDocumentLoadRule;
  timeRange?: {
    from?: string;
    to?: string;
  };
}

export interface AgentDocumentPolicyEvaluationContext {
  currentTime?: Date;
  currentUserMessage?: string;
}

export interface AgentContextDocumentRuleInput {
  loadRules?: AgentDocumentLoadRules;
}

const normalizeLoadRule = (rule?: string): AgentDocumentLoadRule | undefined => {
  switch (rule) {
    case DocumentLoadRule.ALWAYS:
    case DocumentLoadRule.BY_KEYWORDS:
    case DocumentLoadRule.BY_REGEXP:
    case DocumentLoadRule.BY_TIME_RANGE: {
      return rule;
    }
    default: {
      return undefined;
    }
  }
};

export const matchesLoadRules = (
  doc: AgentContextDocumentRuleInput,
  context: AgentDocumentPolicyEvaluationContext,
): boolean => {
  const rules = doc.loadRules;
  const loadRule = normalizeLoadRule(rules?.rule);

  if (!loadRule) return true;

  switch (loadRule) {
    case 'always': {
      return true;
    }
    case 'by-keywords': {
      const userMessage = context.currentUserMessage?.toLowerCase();
      const keywords = rules?.keywords?.map((k) => k.toLowerCase()).filter(Boolean) || [];
      if (!userMessage || keywords.length === 0) return false;

      if (rules?.keywordMatchMode === 'all') {
        return keywords.every((keyword) => userMessage.includes(keyword));
      }

      return keywords.some((keyword) => userMessage.includes(keyword));
    }
    case 'by-regexp': {
      if (!rules?.regexp || !context.currentUserMessage) return false;
      try {
        return new RegExp(rules.regexp, 'i').test(context.currentUserMessage);
      } catch {
        return false;
      }
    }
    case 'by-time-range': {
      const now = context.currentTime || new Date();
      const from = rules?.timeRange?.from
        ? Date.parse(rules.timeRange.from)
        : Number.NEGATIVE_INFINITY;
      const to = rules?.timeRange?.to ? Date.parse(rules.timeRange.to) : Number.POSITIVE_INFINITY;
      if (Number.isNaN(from) || Number.isNaN(to)) return false;
      const current = now.getTime();
      return current >= from && current <= to;
    }
  }
};

export const shouldInjectDocument = (
  doc: AgentContextDocumentRuleInput,
  context: AgentDocumentPolicyEvaluationContext,
): boolean => {
  return matchesLoadRules(doc, context);
};

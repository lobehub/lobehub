// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  AgentAccess,
  type AgentDocumentWithRules,
  DocumentLoadFormat,
  DocumentLoadPosition,
  DocumentLoadRule,
  PolicyLoad,
} from '../../types';
import {
  canAutoLoadDocument,
  canDeleteDocument,
  canListDocument,
  canReadDocument,
  canWriteDocument,
  composeToolPolicyUpdate,
  isLoadableDocument,
  normalizePolicy,
  parseLoadRules,
  resolveDocumentLoadPosition,
  sortByLoadRulePriority,
} from '..';

describe('agentDocuments checks', () => {
  it('normalizes policy with defaults and load rule fallbacks', () => {
    const policy = normalizePolicy(DocumentLoadPosition.BEFORE_SYSTEM, {
      priority: 2,
      maxTokens: 100,
    });

    expect(policy.context?.position).toBe(DocumentLoadPosition.BEFORE_SYSTEM);
    expect(policy.context?.priority).toBe(2);
    expect(policy.context?.maxTokens).toBe(100);
    expect(policy.context?.policyLoadFormat).toBe(DocumentLoadFormat.RAW);
    expect(policy.context?.rule).toBe(DocumentLoadRule.ALWAYS);
  });

  it('composes tool policy update with mode-derived autoload access', () => {
    const composed = composeToolPolicyUpdate(
      { context: { priority: 1, loadMode: 'always' } },
      {
        mode: 'manual',
        policyLoadFormat: 'file',
        rule: 'by-keywords',
        keywords: ['risk'],
      },
    );

    expect(composed.policyLoad).toBe(PolicyLoad.DISABLED);
    expect(composed.policyLoadFormat).toBe(DocumentLoadFormat.FILE);
    expect(composed.policyLoadRule).toBe(DocumentLoadRule.BY_KEYWORDS);
    expect(composed.policy.context?.keywords).toEqual(['risk']);
  });

  it('parses load rules and resolves document position', () => {
    const doc = {
      policy: {
        context: {
          keywordMatchMode: 'all' as const,
          keywords: ['alpha'],
          maxTokens: 42,
          position: DocumentLoadPosition.AFTER_KNOWLEDGE,
          priority: 3,
          regexp: 'alpha',
          rule: DocumentLoadRule.BY_REGEXP,
        },
      },
      policyLoadPosition: DocumentLoadPosition.BEFORE_FIRST_USER,
      policyLoadRule: DocumentLoadRule.ALWAYS,
    };

    expect(parseLoadRules(doc).rule).toBe(DocumentLoadRule.BY_REGEXP);
    expect(resolveDocumentLoadPosition(doc)).toBe(DocumentLoadPosition.AFTER_KNOWLEDGE);
  });

  it('sorts documents by load rule priority ascending', () => {
    const lowPriority = { loadRules: { priority: 5 } } as unknown as AgentDocumentWithRules;
    const highPriority = { loadRules: { priority: 1 } } as unknown as AgentDocumentWithRules;
    const defaultPriority = { loadRules: {} } as unknown as AgentDocumentWithRules;

    const sorted = sortByLoadRulePriority([lowPriority, highPriority, defaultPriority]);

    expect(sorted.map((item) => item.loadRules.priority)).toEqual([1, 5, undefined]);
  });

  it('applies composable permission checks', () => {
    const fullAccessDoc = {
      accessSelf:
        AgentAccess.EXECUTE |
        AgentAccess.LIST |
        AgentAccess.READ |
        AgentAccess.WRITE |
        AgentAccess.DELETE,
      policyLoad: PolicyLoad.ALWAYS,
    };

    expect(canListDocument(fullAccessDoc)).toBe(true);
    expect(canReadDocument(fullAccessDoc)).toBe(true);
    expect(canWriteDocument(fullAccessDoc)).toBe(true);
    expect(canDeleteDocument(fullAccessDoc)).toBe(true);
    expect(canAutoLoadDocument(fullAccessDoc)).toBe(true);
    expect(isLoadableDocument(fullAccessDoc)).toBe(true);

    const noReadDoc = {
      accessSelf: AgentAccess.LIST,
      policyLoad: PolicyLoad.ALWAYS,
    };

    expect(isLoadableDocument(noReadDoc)).toBe(false);
  });
});

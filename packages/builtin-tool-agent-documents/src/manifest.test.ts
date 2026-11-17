import { describe, expect, it } from 'vitest';

import { AgentDocumentsManifest } from './manifest';
import { AgentDocumentsApiName } from './types';

const updateLoadRuleApi = AgentDocumentsManifest.api.find(
  (api) => api.name === AgentDocumentsApiName.updateLoadRule,
)!;
const ruleProperties = (updateLoadRuleApi.parameters as any).properties.rule.properties;

describe('AgentDocumentsManifest.updateLoadRule', () => {
  // T-14044: the schema only offered maxTokens/priority, which apply to
  // "always" documents, while created documents start progressive — so the
  // model had no way to get a document injected.
  it('lets the model switch a document between progressive and always', () => {
    expect(ruleProperties.mode).toMatchObject({
      enum: ['always', 'progressive'],
      type: 'string',
    });
  });

  it('says maxTokens and priority only matter in always mode', () => {
    expect(ruleProperties.maxTokens.description).toContain('Applies only in "always" mode');
    expect(ruleProperties.priority.description).toContain('Has no effect in "progressive" mode');
  });

  it('matches the integer-only token cap and priority the server accepts', () => {
    expect(ruleProperties.maxTokens.type).toBe('integer');
    expect(ruleProperties.priority.type).toBe('integer');
  });
});

import { describe, expect, it } from 'vitest';

import { evaluateFeatureFlag, FeatureFlagsSchema, mapFeatureFlagsEnvToState } from './schema';

describe('FeatureFlagsSchema', () => {
  it('should validate correct feature flags with boolean values', () => {
    const result = FeatureFlagsSchema.safeParse({
      provider_settings: false,
      openai_api_key: true,
      openai_proxy_url: false,
      create_session: true,
      edit_agent: false,
      dalle: true,
      ai_image: true,
    });

    expect(result.success).toBe(true);
  });

  it('should validate correct feature flags with user ID arrays', () => {
    const result = FeatureFlagsSchema.safeParse({
      edit_agent: ['user-123', 'user-456'],
      create_session: ['user-789'],
      dalle: true,
      ai_image: false,
    });

    expect(result.success).toBe(true);
  });

  it('should validate mixed boolean and array values', () => {
    const result = FeatureFlagsSchema.safeParse({
      edit_agent: ['user-123'],
      create_session: true,
      dalle: false,
      knowledge_base: ['user-456', 'user-789'],
    });

    expect(result.success).toBe(true);
  });

  it('should reject invalid feature flags with wrong types', () => {
    const result = FeatureFlagsSchema.safeParse({
      edit_agent: 'yes', // Invalid type, should be boolean or array
    });

    expect(result.success).toBe(false);
  });

  it('should reject invalid feature flags with non-string array elements', () => {
    const result = FeatureFlagsSchema.safeParse({
      edit_agent: [123, 456], // Invalid, array should contain strings
    });

    expect(result.success).toBe(false);
  });
});

describe('evaluateFeatureFlag', () => {
  it('should return true for boolean true value', () => {
    expect(evaluateFeatureFlag(true)).toBe(true);
    expect(evaluateFeatureFlag(true, 'user-123')).toBe(true);
  });

  it('should return false for boolean false value', () => {
    expect(evaluateFeatureFlag(false)).toBe(false);
    expect(evaluateFeatureFlag(false, 'user-123')).toBe(false);
  });

  it('should return undefined for undefined value', () => {
    expect(evaluateFeatureFlag(undefined)).toBe(undefined);
    expect(evaluateFeatureFlag(undefined, 'user-123')).toBe(undefined);
  });

  it('should return true if user ID is in the allowlist', () => {
    const allowlist = ['user-123', 'user-456'];
    expect(evaluateFeatureFlag(allowlist, 'user-123')).toBe(true);
    expect(evaluateFeatureFlag(allowlist, 'user-456')).toBe(true);
  });

  it('should return false if user ID is not in the allowlist', () => {
    const allowlist = ['user-123', 'user-456'];
    expect(evaluateFeatureFlag(allowlist, 'user-789')).toBe(false);
  });

  it('should return false if no user ID provided with array value', () => {
    const allowlist = ['user-123', 'user-456'];
    expect(evaluateFeatureFlag(allowlist)).toBe(false);
    expect(evaluateFeatureFlag(allowlist, undefined)).toBe(false);
  });

  it('should handle empty array', () => {
    expect(evaluateFeatureFlag([], 'user-123')).toBe(false);
    expect(evaluateFeatureFlag([])).toBe(false);
  });
});

describe('mapFeatureFlagsEnvToState', () => {
  it('should correctly map boolean feature flags to state', () => {
    const config = {
      provider_settings: true,
      openai_api_key: true,
      openai_proxy_url: false,
      edit_agent: false,
      ai_image: true,
      check_updates: true,
      welcome_suggest: true,
      knowledge_base: false,
      rag_eval: true,
      market: true,
      speech_to_text: true,
      changelog: false,
      api_key_manage: false,
      cloud_promotion: true,
      commercial_hide_github: false,
      commercial_hide_docs: true,
    };

    const mappedState = mapFeatureFlagsEnvToState(config);

    expect(mappedState).toMatchObject({
      isAgentEditable: false,
      showProvider: true,
      showOpenAIApiKey: true,
      showOpenAIProxyUrl: false,
      showApiKeyManage: false,
      showAiImage: true,
      showChangelog: false,
      enableCheckUpdates: true,
      showWelcomeSuggest: true,
      enableKnowledgeBase: false,
      enableRAGEval: true,
      showMarket: true,
      enableSTT: true,
      showCloudPromotion: true,
      hideGitHub: false,
      hideDocs: true,
    });
  });

  it('should correctly evaluate user-specific flags with allowlist', () => {
    const userId = 'user-123';
    const config = {
      edit_agent: ['user-123', 'user-456'],
      create_session: ['user-789'],
      dalle: true,
      knowledge_base: ['user-123'],
    };

    const mappedState = mapFeatureFlagsEnvToState(config, userId);

    expect(mappedState.isAgentEditable).toBe(true); // user-123 is in allowlist

    expect(mappedState.enableKnowledgeBase).toBe(true); // user-123 is in allowlist
  });

  it('should return false for array flags when user ID is not in allowlist', () => {
    const userId = 'user-999';
    const config = {
      edit_agent: ['user-123', 'user-456'],
      create_session: ['user-789'],
      dalle: true,
    };

    const mappedState = mapFeatureFlagsEnvToState(config, userId);

    expect(mappedState.isAgentEditable).toBe(false);
  });

  it('should return false for array flags when no user ID provided', () => {
    const config = {
      edit_agent: ['user-123', 'user-456'],
      create_session: true,
    };

    const mappedState = mapFeatureFlagsEnvToState(config);

    expect(mappedState.isAgentEditable).toBe(false);
  });

  it('should handle mixed boolean and array values correctly', () => {
    const userId = 'user-123';
    const config = {
      edit_agent: ['user-123'],
      create_session: true,
      dalle: false,
      ai_image: ['user-456'],
      knowledge_base: ['user-123', 'user-789'],
      rag_eval: true,
    };

    const mappedState = mapFeatureFlagsEnvToState(config, userId);

    expect(mappedState.isAgentEditable).toBe(true);

    expect(mappedState.showAiImage).toBe(false);
    expect(mappedState.enableKnowledgeBase).toBe(true);
    expect(mappedState.enableRAGEval).toBe(true);
  });
});

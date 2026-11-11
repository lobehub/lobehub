import { describe, expect, it } from 'vitest';

import {
  DEFAULT_FEATURE_FLAGS,
  evaluateFeatureFlag,
  FeatureFlagsSchema,
  mapFeatureFlagsEnvToState,
} from './schema';

describe('FeatureFlagsSchema', () => {
  /**
   * A published runtime-config snapshot may still hold a flag that was since removed;
   * it must neither fail validation nor reach the mapped client state.
   */
  it('drops unknown flags instead of failing validation', () => {
    const result = FeatureFlagsSchema.safeParse({ dashboard: true, some_removed_flag: ['user-1'] });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ dashboard: true });
  });

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

  it('should validate workspace IDs configured for DevDock access', () => {
    const result = FeatureFlagsSchema.safeParse({
      dev_dock_workspaces: ['workspace-123', 'workspace-456'],
    });

    expect(result.success).toBe(true);
  });

  it('should reject a boolean DevDock workspace scope', () => {
    const result = FeatureFlagsSchema.safeParse({
      dev_dock_workspaces: true,
    });

    expect(result.success).toBe(false);
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

  describe('percentage rollout token', () => {
    const userIds = Array.from({ length: 10_000 }, (_, i) => `user-${i}`);
    const enabledUsers = (value: string[], flagKey: string) =>
      userIds.filter((id) => evaluateFeatureFlag(value, id, flagKey));

    it('buckets users by FNV-1a of "flagKey:userId" modulo 100', () => {
      // FNV-1a("channel:user-1") = 4173342739 → bucket 39, derived outside the codebase
      expect(evaluateFeatureFlag(['rollout:39'], 'user-1', 'channel')).toBe(false);
      expect(evaluateFeatureFlag(['rollout:40'], 'user-1', 'channel')).toBe(true);
    });

    it('enables roughly the configured share of users', () => {
      const share = enabledUsers(['rollout:10'], 'channel').length / userIds.length;

      expect(share).toBeGreaterThan(0.08);
      expect(share).toBeLessThan(0.12);
    });

    it('keeps every enabled user enabled when the percentage grows', () => {
      const atTen = enabledUsers(['rollout:10'], 'channel');
      const atTwenty = new Set(enabledUsers(['rollout:20'], 'channel'));

      expect(atTen.every((id) => atTwenty.has(id))).toBe(true);
    });

    it('picks a different population for each flag key', () => {
      const channelUsers = new Set(enabledUsers(['rollout:10'], 'channel'));
      const overlap = enabledUsers(['rollout:10'], 'dashboard').filter((id) =>
        channelUsers.has(id),
      );

      expect(overlap.length).toBeLessThan(channelUsers.size / 2);
    });

    it('enables nobody at 0% and everybody at 100%', () => {
      expect(enabledUsers(['rollout:0'], 'channel')).toHaveLength(0);
      expect(enabledUsers(['rollout:100'], 'channel')).toHaveLength(userIds.length);
    });

    it('still enables allowlisted users outside the rollout bucket', () => {
      expect(evaluateFeatureFlag(['rollout:0', 'user-1'], 'user-1', 'channel')).toBe(true);
    });

    it('ignores malformed rollout tokens', () => {
      for (const token of [
        'rollout:abc',
        'rollout:150',
        'rollout:-5',
        'rollout:10.5',
        'rollout:',
      ]) {
        expect(enabledUsers([token], 'channel')).toHaveLength(0);
      }
    });

    it('does not treat the token as a user id', () => {
      expect(evaluateFeatureFlag(['rollout:0'], 'rollout:0', 'channel')).toBe(false);
    });

    it('returns false for anonymous callers', () => {
      expect(evaluateFeatureFlag(['rollout:100'], undefined, 'channel')).toBe(false);
    });
  });
});

describe('mapFeatureFlagsEnvToState', () => {
  it('should map the default feature flags', () => {
    const mappedState = mapFeatureFlagsEnvToState(DEFAULT_FEATURE_FLAGS);

    expect(mappedState.enableAuthCaptcha).toBe(true);
    expect(mappedState.enableStorageOverage).toBe(true);
    expect(mappedState.enableVoiceDictation).toBe(false);
    expect(mappedState.enableOnboardingV2).toBe(false);
  });

  it('should map the onboarding v2 allowlist flag by user ID', () => {
    const config = {
      onboarding_v2: ['user-123'],
    };

    expect(mapFeatureFlagsEnvToState(config, 'user-123').enableOnboardingV2).toBe(true);
    expect(mapFeatureFlagsEnvToState(config, 'user-456').enableOnboardingV2).toBe(false);
    expect(mapFeatureFlagsEnvToState(config).enableOnboardingV2).toBe(false);
  });

  it('should map the workspace allowlist flag by user ID', () => {
    const config = {
      workspace: ['user-123'],
    };

    expect(mapFeatureFlagsEnvToState(config, 'user-123').enableWorkspace).toBe(true);
    expect(mapFeatureFlagsEnvToState(config, 'user-456').enableWorkspace).toBe(false);
    expect(mapFeatureFlagsEnvToState(config).enableWorkspace).toBe(false);
  });

  it('should map DevDock access only for allowlisted user IDs', () => {
    const config = {
      dev_dock: ['developer-123'],
    };

    expect(mapFeatureFlagsEnvToState(config, 'developer-123').enableDevDock).toBe(true);
    expect(mapFeatureFlagsEnvToState(config, 'user-456').enableDevDock).toBe(false);
    expect(mapFeatureFlagsEnvToState(config).enableDevDock).toBe(false);
  });

  it('should keep agent share publishing off by default and enable it for listed creators', () => {
    expect(DEFAULT_FEATURE_FLAGS.agent_share).toBe(false);
    expect(mapFeatureFlagsEnvToState(DEFAULT_FEATURE_FLAGS, 'user-1').enableAgentShare).toBe(false);

    const config = { agent_share: ['creator-123'] };

    expect(mapFeatureFlagsEnvToState(config, 'creator-123').enableAgentShare).toBe(true);
    expect(mapFeatureFlagsEnvToState(config, 'user-456').enableAgentShare).toBe(false);
    expect(mapFeatureFlagsEnvToState(config).enableAgentShare).toBe(false);
  });

  it('should keep mobile new-tier sales off by default and enable them for listed users', () => {
    expect(DEFAULT_FEATURE_FLAGS.mobile_new_tier_sales).toBe(false);
    expect(
      mapFeatureFlagsEnvToState(DEFAULT_FEATURE_FLAGS, 'user-1').enableMobileNewTierSales,
    ).toBe(false);

    const config = { mobile_new_tier_sales: ['tester-123'] };

    expect(mapFeatureFlagsEnvToState(config, 'tester-123').enableMobileNewTierSales).toBe(true);
    expect(mapFeatureFlagsEnvToState(config, 'user-456').enableMobileNewTierSales).toBe(false);
    expect(mapFeatureFlagsEnvToState(config).enableMobileNewTierSales).toBe(false);
  });

  it('should always report the new tiers as on for released clients that still read the flag', () => {
    expect(mapFeatureFlagsEnvToState({}, 'user-1').enableNewTierPlans).toBe(true);
    expect(mapFeatureFlagsEnvToState(DEFAULT_FEATURE_FLAGS).enableNewTierPlans).toBe(true);
  });

  it('should keep the mobile sandbox grant off by default and out of the client state', () => {
    expect(DEFAULT_FEATURE_FLAGS.mobile_sandbox_grant).toBe(false);
    expect(FeatureFlagsSchema.parse({ mobile_sandbox_grant: ['tester-123'] })).toEqual({
      mobile_sandbox_grant: ['tester-123'],
    });
    expect(
      mapFeatureFlagsEnvToState({ mobile_sandbox_grant: ['tester-123'] }, 'tester-123'),
    ).toEqual(mapFeatureFlagsEnvToState({}, 'tester-123'));
  });

  it('should keep topic previews off by default and enable them for listed users', () => {
    expect(DEFAULT_FEATURE_FLAGS.topic_preview).toBe(false);
    expect(mapFeatureFlagsEnvToState(DEFAULT_FEATURE_FLAGS, 'user-1').enableTopicPreview).toBe(
      false,
    );

    const config = { topic_preview: ['user-123'] };

    expect(mapFeatureFlagsEnvToState(config, 'user-123').enableTopicPreview).toBe(true);
    expect(mapFeatureFlagsEnvToState(config, 'user-456').enableTopicPreview).toBe(false);
  });

  it('should gate the mobile gateway mux behind its own flag', () => {
    expect(DEFAULT_FEATURE_FLAGS.agent_gateway_mux_mobile).toBe(false);
    expect(mapFeatureFlagsEnvToState(DEFAULT_FEATURE_FLAGS, 'user-1').enableGatewayMuxMobile).toBe(
      false,
    );

    const everyone = mapFeatureFlagsEnvToState({ agent_gateway_mux_mobile: true }, 'user-1');
    expect(everyone.enableGatewayMuxMobile).toBe(true);

    const config = { agent_gateway_mux_mobile: ['user-123'] };
    expect(mapFeatureFlagsEnvToState(config, 'user-123').enableGatewayMuxMobile).toBe(true);
    expect(mapFeatureFlagsEnvToState(config, 'user-456').enableGatewayMuxMobile).toBe(false);
    expect(mapFeatureFlagsEnvToState(config).enableGatewayMuxMobile).toBe(false);
  });

  it('should keep dashboards off by default and enable them per user or globally', () => {
    expect(DEFAULT_FEATURE_FLAGS.dashboard).toBe(false);
    expect(mapFeatureFlagsEnvToState(DEFAULT_FEATURE_FLAGS, 'user-1').enableDashboard).toBe(false);

    expect(mapFeatureFlagsEnvToState({ dashboard: true }).enableDashboard).toBe(true);

    const config = { dashboard: ['user-123'] };
    expect(mapFeatureFlagsEnvToState(config, 'user-123').enableDashboard).toBe(true);
    expect(mapFeatureFlagsEnvToState(config, 'user-456').enableDashboard).toBe(false);
    expect(mapFeatureFlagsEnvToState(config).enableDashboard).toBe(false);
  });

  it('should keep MCP Apps views off by default and enable them per user or globally', () => {
    expect(DEFAULT_FEATURE_FLAGS.mcp_apps).toBe(false);
    expect(mapFeatureFlagsEnvToState(DEFAULT_FEATURE_FLAGS, 'user-1').enableMcpApps).toBe(false);

    expect(mapFeatureFlagsEnvToState({ mcp_apps: true }).enableMcpApps).toBe(true);

    const config = { mcp_apps: ['user-123'] };
    expect(mapFeatureFlagsEnvToState(config, 'user-123').enableMcpApps).toBe(true);
    expect(mapFeatureFlagsEnvToState(config, 'user-456').enableMcpApps).toBe(false);
  });

  it('should keep agent knowledge spaces off by default and enable them per user', () => {
    expect(DEFAULT_FEATURE_FLAGS.agent_knowledge_space).toBe(false);
    expect(
      mapFeatureFlagsEnvToState(DEFAULT_FEATURE_FLAGS, 'user-1').enableAgentKnowledgeSpace,
    ).toBe(false);

    const config = { agent_knowledge_space: ['user-123'] };
    expect(mapFeatureFlagsEnvToState(config, 'user-123').enableAgentKnowledgeSpace).toBe(true);
    expect(mapFeatureFlagsEnvToState(config, 'user-456').enableAgentKnowledgeSpace).toBe(false);
  });

  it('should keep the rail layout off by default and enable it per user or globally', () => {
    expect(DEFAULT_FEATURE_FLAGS.im_layout).toBe(false);
    expect(mapFeatureFlagsEnvToState(DEFAULT_FEATURE_FLAGS, 'user-1').enableImLayout).toBe(false);

    expect(mapFeatureFlagsEnvToState({ im_layout: true }).enableImLayout).toBe(true);

    const config = { im_layout: ['user-123'] };
    expect(mapFeatureFlagsEnvToState(config, 'user-123').enableImLayout).toBe(true);
    expect(mapFeatureFlagsEnvToState(config, 'user-456').enableImLayout).toBe(false);
  });

  it('should keep Channels off by default and enable them per user or globally', () => {
    expect(DEFAULT_FEATURE_FLAGS.channel).toBe(false);
    expect(mapFeatureFlagsEnvToState(DEFAULT_FEATURE_FLAGS, 'user-1').enableChannels).toBe(false);

    expect(mapFeatureFlagsEnvToState({ channel: true }).enableChannels).toBe(true);

    const config = { channel: ['user-123'] };
    expect(mapFeatureFlagsEnvToState(config, 'user-123').enableChannels).toBe(true);
    expect(mapFeatureFlagsEnvToState(config, 'user-456').enableChannels).toBe(false);
    expect(mapFeatureFlagsEnvToState(config).enableChannels).toBe(false);
  });

  it('should keep managed cloud device creation off by default and enable it per user or globally', () => {
    expect(DEFAULT_FEATURE_FLAGS.managed_cloud_device).toBe(false);
    expect(
      mapFeatureFlagsEnvToState(DEFAULT_FEATURE_FLAGS, 'user-1').enableManagedCloudDevice,
    ).toBe(false);

    expect(mapFeatureFlagsEnvToState({ managed_cloud_device: true }).enableManagedCloudDevice).toBe(
      true,
    );

    const config = { managed_cloud_device: ['user-123'] };
    expect(mapFeatureFlagsEnvToState(config, 'user-123').enableManagedCloudDevice).toBe(true);
    expect(mapFeatureFlagsEnvToState(config, 'user-456').enableManagedCloudDevice).toBe(false);
    expect(mapFeatureFlagsEnvToState(config).enableManagedCloudDevice).toBe(false);
  });

  it('should keep allowlisted users on while managed cloud device creation rolls out', () => {
    const allowlistOnly = { managed_cloud_device: ['rollout:0', 'user-123'] };
    expect(mapFeatureFlagsEnvToState(allowlistOnly, 'user-123').enableManagedCloudDevice).toBe(
      true,
    );
    expect(mapFeatureFlagsEnvToState(allowlistOnly, 'user-456').enableManagedCloudDevice).toBe(
      false,
    );

    const everyone = { managed_cloud_device: ['rollout:100', 'user-123'] };
    expect(mapFeatureFlagsEnvToState(everyone, 'user-456').enableManagedCloudDevice).toBe(true);
  });

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
      agent_onboarding: true,
      auth_captcha: true,
      market: true,
      speech_to_text: true,
      voice_dictation: true,
      changelog: false,
      api_key_manage: false,
      cloud_promotion: true,
      storage_overage: false,
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
      enableAgentOnboarding: true,
      enableAuthCaptcha: true,
      enableStorageOverage: false,
      showMarket: true,
      enableSTT: true,
      enableVoiceDictation: true,
      showCloudPromotion: true,
      hideGitHub: false,
      hideDocs: true,
    });
  });

  it('should correctly evaluate user-specific flags with allowlist', () => {
    const userId = 'user-123';
    const config = {
      edit_agent: ['user-123', 'user-456'],
      agent_onboarding: ['user-123'],
      auth_captcha: ['user-123'],
      storage_overage: ['user-123'],
      create_session: ['user-789'],
      dalle: true,
      knowledge_base: ['user-123'],
    };

    const mappedState = mapFeatureFlagsEnvToState(config, userId);

    expect(mappedState.isAgentEditable).toBe(true); // user-123 is in allowlist
    expect(mappedState.enableAgentOnboarding).toBe(true); // user-123 is in allowlist
    expect(mappedState.enableAuthCaptcha).toBe(true); // user-123 is in allowlist
    expect(mappedState.enableStorageOverage).toBe(true); // user-123 is in allowlist
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
      agent_onboarding: ['user-1'],
      edit_agent: ['user-123', 'user-456'],
      create_session: true,
    };

    const mappedState = mapFeatureFlagsEnvToState(config);
    expect(mappedState.enableAgentOnboarding).toBe(false);
    expect(mappedState.isAgentEditable).toBe(false);
  });

  it('should handle mixed boolean and array values correctly', () => {
    const userId = 'user-123';
    const config = {
      edit_agent: ['user-123'],
      agent_onboarding: ['user-123'],
      create_session: true,
      dalle: false,
      ai_image: ['user-456'],
      knowledge_base: ['user-123', 'user-789'],
      rag_eval: true,
    };

    const mappedState = mapFeatureFlagsEnvToState(config, userId);

    expect(mappedState.isAgentEditable).toBe(true);
    expect(mappedState.enableAgentOnboarding).toBe(true);
    expect(mappedState.showAiImage).toBe(false);
    expect(mappedState.enableKnowledgeBase).toBe(true);
    expect(mappedState.enableRAGEval).toBe(true);
  });

  it('salts the rollout bucket with each flag key', () => {
    // user-1 lands in bucket 39 for channel and 74 for dashboard
    const config = { channel: ['rollout:40'], dashboard: ['rollout:40'] };
    const mappedState = mapFeatureFlagsEnvToState(config, 'user-1');

    expect(mappedState.enableChannels).toBe(true);
    expect(mappedState.enableDashboard).toBe(false);
  });

  describe('agent_runtime_strip_operation_toolset', () => {
    it('is off by default', () => {
      expect(DEFAULT_FEATURE_FLAGS.agent_runtime_strip_operation_toolset).toBe(false);
      expect(
        mapFeatureFlagsEnvToState(DEFAULT_FEATURE_FLAGS, 'user-1').enableStripOperationToolset,
      ).toBe(false);
    });

    it('maps true to enabled for every user', () => {
      const config = { agent_runtime_strip_operation_toolset: true };

      expect(mapFeatureFlagsEnvToState(config, 'user-1').enableStripOperationToolset).toBe(true);
      expect(mapFeatureFlagsEnvToState(config).enableStripOperationToolset).toBe(true);
    });

    it('maps a user allowlist to the listed users only', () => {
      const config = FeatureFlagsSchema.parse({
        agent_runtime_strip_operation_toolset: ['user-1'],
      });

      expect(mapFeatureFlagsEnvToState(config, 'user-1').enableStripOperationToolset).toBe(true);
      expect(mapFeatureFlagsEnvToState(config, 'user-2').enableStripOperationToolset).toBe(false);
      expect(mapFeatureFlagsEnvToState(config).enableStripOperationToolset).toBe(false);
    });
  });
});

import type { IFeatureFlagsState } from '@lobechat/types';
import { z } from 'zod';

// Define a union type for feature flag values: either boolean or array of user IDs
const FeatureFlagValue = z.union([z.boolean(), z.array(z.string())]);
const isDev = process.env.NODE_ENV === 'development';

export const FeatureFlagsSchema = z.object({
  check_updates: FeatureFlagValue.optional(),

  // settings
  provider_settings: FeatureFlagValue.optional(),

  openai_api_key: FeatureFlagValue.optional(),
  openai_proxy_url: FeatureFlagValue.optional(),

  // profile
  api_key_manage: FeatureFlagValue.optional(),
  edit_agent: FeatureFlagValue.optional(),

  /**
   * Cloud-only grayscale gate for Agent Share, covering BOTH capabilities the
   * feature has: PUBLISHING a share (creator side) and OPENING/chatting on a
   * shared agent (visitor side). A user matched by this flag can do both;
   * everyone else can do neither. Array values are user IDs. The share OWNER previewing their own share is
   * never subject to the visitor check — only other visitors are. Self-hosted
   * builds are additionally hard-blocked server-side by
   * `ENABLE_BUSINESS_FEATURES` (see `_helpers/agentShareFeatureGate.ts`), so
   * this flag alone can never enable the feature outside Cloud.
   */
  agent_share: FeatureFlagValue.optional(),

  ai_image: FeatureFlagValue.optional(),
  speech_to_text: FeatureFlagValue.optional(),
  voice_dictation: FeatureFlagValue.optional(),
  token_counter: FeatureFlagValue.optional(),

  welcome_suggest: FeatureFlagValue.optional(),
  changelog: FeatureFlagValue.optional(),

  market: FeatureFlagValue.optional(),
  knowledge_base: FeatureFlagValue.optional(),

  rag_eval: FeatureFlagValue.optional(),

  // internal flag
  agent_self_iteration: FeatureFlagValue.optional(),
  agent_onboarding: FeatureFlagValue.optional(),
  dev_dock: FeatureFlagValue.optional(),
  dev_dock_workspaces: z.array(z.string()).optional(),
  // Cloud feature flag. Keep here until cloud owns a separate runtime flag domain.
  auth_captcha: FeatureFlagValue.optional(),
  cloud_promotion: FeatureFlagValue.optional(),
  onboarding_v2: FeatureFlagValue.optional(),
  storage_overage: FeatureFlagValue.optional(),
  workspace: FeatureFlagValue.optional(),

  // the flags below can only be used with commercial license
  // if you want to use it in the commercial usage
  // please contact us for more information: hello@lobehub.com
  commercial_hide_github: FeatureFlagValue.optional(),
  commercial_hide_docs: FeatureFlagValue.optional(),
});

export type IFeatureFlags = z.infer<typeof FeatureFlagsSchema>;

/**
 * Evaluate a feature flag value against a user ID
 * @param flagValue - The feature flag value (boolean or array of user IDs)
 * @param userId - The current user ID
 * @returns boolean indicating if the feature is enabled for the user
 */
export const evaluateFeatureFlag = (
  flagValue: boolean | string[] | undefined,
  userId?: string,
): boolean | undefined => {
  if (typeof flagValue === 'boolean') return flagValue;

  if (Array.isArray(flagValue)) {
    if (userId && flagValue.includes(userId)) return true;
    return false;
  }
};

export const DEFAULT_FEATURE_FLAGS: IFeatureFlags = {
  provider_settings: true,

  openai_api_key: true,
  openai_proxy_url: true,

  api_key_manage: false,
  edit_agent: true,

  // Cloud-only grayscale: off everywhere until an admin publishes a whitelist
  // (array of user IDs) or flips it to true. Self-hosted deployments
  // are additionally hard-blocked by ENABLE_BUSINESS_FEATURES on the server
  // gate, so setting this env-side does not enable the feature there.
  agent_share: false,

  ai_image: true,

  check_updates: true,
  welcome_suggest: true,
  token_counter: true,

  knowledge_base: true,
  rag_eval: false,

  agent_self_iteration: isDev,
  agent_onboarding: isDev,
  dev_dock: isDev,
  auth_captcha: true,
  cloud_promotion: false,
  onboarding_v2: isDev,
  storage_overage: true,
  workspace: isDev,

  market: true,
  speech_to_text: true,
  voice_dictation: false,
  changelog: true,

  // the flags below can only be used with commercial license
  // if you want to use it in the commercial usage
  // please contact us for more information: hello@lobehub.com
  commercial_hide_github: false,
  commercial_hide_docs: false,
};

// The explicit return type pins this mapping to the canonical shared interface:
// adding a flag here without updating `IFeatureFlagsState` (or vice versa) is a
// compile error, so the two can never drift apart.
export const mapFeatureFlagsEnvToState = (
  config: IFeatureFlags,
  userId?: string,
): IFeatureFlagsState => {
  return {
    isAgentEditable: evaluateFeatureFlag(config.edit_agent, userId),

    enableAgentShare: evaluateFeatureFlag(config.agent_share, userId),
    showProvider: evaluateFeatureFlag(config.provider_settings, userId),

    showOpenAIApiKey: evaluateFeatureFlag(config.openai_api_key, userId),
    showOpenAIProxyUrl: evaluateFeatureFlag(config.openai_proxy_url, userId),

    showApiKeyManage: evaluateFeatureFlag(config.api_key_manage, userId),

    showAiImage: evaluateFeatureFlag(config.ai_image, userId),
    showChangelog: evaluateFeatureFlag(config.changelog, userId),

    enableCheckUpdates: evaluateFeatureFlag(config.check_updates, userId),
    showWelcomeSuggest: evaluateFeatureFlag(config.welcome_suggest, userId),

    enableKnowledgeBase: evaluateFeatureFlag(config.knowledge_base, userId),
    enableRAGEval: evaluateFeatureFlag(config.rag_eval, userId),
    enableAgentSelfIteration: evaluateFeatureFlag(config.agent_self_iteration, userId),
    enableAgentOnboarding: evaluateFeatureFlag(config.agent_onboarding, userId),
    enableDevDock: evaluateFeatureFlag(config.dev_dock, userId),
    enableAuthCaptcha: evaluateFeatureFlag(config.auth_captcha, userId),
    enableOnboardingV2: evaluateFeatureFlag(config.onboarding_v2, userId),
    enableStorageOverage: evaluateFeatureFlag(config.storage_overage, userId),

    showCloudPromotion: evaluateFeatureFlag(config.cloud_promotion, userId),
    enableWorkspace: evaluateFeatureFlag(config.workspace, userId),

    showMarket: evaluateFeatureFlag(config.market, userId),
    enableSTT: evaluateFeatureFlag(config.speech_to_text, userId),
    enableVoiceDictation: evaluateFeatureFlag(config.voice_dictation, userId),

    hideGitHub: evaluateFeatureFlag(config.commercial_hide_github, userId),
    hideDocs: evaluateFeatureFlag(config.commercial_hide_docs, userId),
  };
};

export type { IFeatureFlagsState };

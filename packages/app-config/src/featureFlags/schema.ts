import { ENABLE_BUSINESS_FEATURES } from '@lobechat/business-const';
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
   * Rollout gate for publishing or re-enabling Agent Share. Array values are
   * creator user IDs. Visiting, chatting on, and managing existing shares do
   * not require this flag. Deployment support is independently enforced by
   * `ENABLE_BUSINESS_FEATURES` (see `_helpers/agentShareFeatureGate.ts`).
   */
  agent_share: FeatureFlagValue.optional(),

  ai_image: FeatureFlagValue.optional(),
  speech_to_text: FeatureFlagValue.optional(),
  token_counter: FeatureFlagValue.optional(),

  welcome_suggest: FeatureFlagValue.optional(),
  changelog: FeatureFlagValue.optional(),

  market: FeatureFlagValue.optional(),
  knowledge_base: FeatureFlagValue.optional(),

  rag_eval: FeatureFlagValue.optional(),

  /**
   * Rollout gate for relaying LLM calls to the user's device: a model provider
   * only that device can reach (a local Ollama / LM Studio, a private-network
   * endpoint) runs one attempt at a time on the client that started the run,
   * while the agent loop stays on the server. Off: such providers keep being
   * dialed by the server. Array values are user ids.
   */
  agent_llm_relay: FeatureFlagValue.optional(),

  /**
   * Rollout gate for deferring an operation's init: a plain chat send returns
   * once its messages are durable and the step-0 worker runs tool discovery and
   * context assembly. Off: the send path runs them before returning. Array
   * values are user ids.
   */
  agent_deferred_init: FeatureFlagValue.optional(),

  /**
   * Rollout gate for answering a plain chat send to a heterogeneous agent
   * (Claude Code, Codex, …) on an online device before the device dispatch
   * completes; the dispatch runs after the response and a failure lands on the
   * assistant message. Off: the send waits for the device to accept the run.
   * Array values are user ids.
   */
  agent_deferred_hetero_dispatch: FeatureFlagValue.optional(),

  /**
   * Keep the immutable per-operation tool set out of the agent state blob that
   * is rewritten at every step; it is written once to its own Redis key and
   * re-attached on load. Off: the blob keeps its inline copy. Server only;
   * `AGENT_RUNTIME_STRIP_OPERATION_TOOLSET=0|1` overrides it. Array values are
   * user ids (the operation's owner).
   */
  agent_runtime_strip_operation_toolset: FeatureFlagValue.optional(),

  /**
   * Dashboards: monitoring widgets built by the `builtin-dashboard` agent tool,
   * the home / project dashboard pages, the widget Portal and in-chat widget
   * previews. Off: none of it is reachable and the tool is never offered;
   * already-published widgets keep refreshing on their schedule. Array values
   * are user ids.
   */
  dashboard: FeatureFlagValue.optional(),

  /**
   * MCP Apps: a tool result that declares an interactive `ui://` view renders
   * that view (third-party HTML in a sandboxed iframe) in the conversation and
   * stays on screen when the turn folds. Off: such results render as plain
   * tool results. Array values are user ids.
   */
  mcp_apps: FeatureFlagValue.optional(),

  /**
   * Rollout gate for moving an agent's documents into its dedicated knowledge
   * base at runtime, and for showing those spaces in the library. Off: no space
   * is created and existing ones stay hidden. Array values are user ids.
   */
  agent_knowledge_space: FeatureFlagValue.optional(),

  /**
   * Trial gate for the rail layout: icon rail + one wrapped list column and
   * content, the IM-style Messages list (Lobe AI opens by default), Contacts,
   * the Tasks scope list and the agent profile side panel. Off keeps the
   * current sidebar layout untouched. Array values are user ids, so it can be
   * tried by an allowlist before anyone else sees it.
   */
  im_layout: FeatureFlagValue.optional(),

  /**
   * Multi-agent Channels: the sidebar section, Channel pages and every Channel API, including
   * Agent history reads (`lobe-channel`, `lh channel`). Off: none of it is reachable. Work that
   * was already queued still finishes. Array values are user ids, checked per member.
   */
  channel: FeatureFlagValue.optional(),

  /**
   * Rollout gate for creating managed cloud devices: the "Create in cloud" entry on the device
   * list and every API that creates one or sets who can create one. Off: the entry does not render
   * and those APIs refuse the call. Managed devices that already exist keep working: they list,
   * wake, connect and can be removed. Array values are user ids, checked per member.
   */
  managed_cloud_device: FeatureFlagValue.optional(),

  topic_preview: FeatureFlagValue.optional(),

  // internal flag
  agent_onboarding: FeatureFlagValue.optional(),
  dev_dock: FeatureFlagValue.optional(),
  dev_dock_workspaces: z.array(z.string()).optional(),
  // Cloud feature flag. Keep here until cloud owns a separate runtime flag domain.
  auth_captcha: FeatureFlagValue.optional(),
  cloud_promotion: FeatureFlagValue.optional(),
  onboarding_v2: FeatureFlagValue.optional(),
  mobile_new_tier_sales: FeatureFlagValue.optional(),
  mobile_sandbox_grant: FeatureFlagValue.optional(),

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
// The percentage lives inside the allowlist array (e.g. `['rollout:10', 'user-a']`) instead of a
// new value shape: every reader of the shared snapshot (this schema, develop-center, lobe-admin)
// only accepts `boolean | string[]`, and an unknown shape makes the runtime drop the whole snapshot.
const ROLLOUT_TOKEN_PATTERN = /^rollout:(\d{1,3})$/;

const parseRolloutPercent = (values: string[]): number | undefined => {
  for (const value of values) {
    const match = ROLLOUT_TOKEN_PATTERN.exec(value);
    if (!match) continue;

    const percent = Number(match[1]);
    if (percent <= 100) return percent;
  }
};

const fnv1a = (input: string) => {
  let hash = 0x81_1c_9d_c5;
  for (const byte of new TextEncoder().encode(input)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01_00_01_93);
  }
  return hash >>> 0;
};

export const evaluateFeatureFlag = (
  flagValue: boolean | string[] | undefined,
  userId?: string,
  flagKey = '',
): boolean | undefined => {
  if (typeof flagValue === 'boolean') return flagValue;

  if (Array.isArray(flagValue)) {
    if (!userId) return false;
    if (!ROLLOUT_TOKEN_PATTERN.test(userId) && flagValue.includes(userId)) return true;

    const percent = parseRolloutPercent(flagValue);
    if (percent === undefined) return false;

    return fnv1a(`${flagKey}:${userId}`) % 100 < percent;
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

  // Off until the client executor ships everywhere; allowlist first.
  agent_llm_relay: false,
  agent_deferred_init: false,
  agent_deferred_hetero_dispatch: false,
  agent_runtime_strip_operation_toolset: false,

  // Off until an admin publishes a user allowlist or flips it to true.
  dashboard: false,

  // Off: a personal-trial layout, enabled per user id.
  im_layout: false,

  // Off until an admin publishes a user allowlist or flips it to true.
  mcp_apps: false,
  agent_knowledge_space: false,

  // Off until an admin publishes a user allowlist or flips it to true.
  channel: false,

  // Off until an admin publishes a user allowlist or flips it to true.
  managed_cloud_device: false,

  // Off until the backend replaces the preview read; allowlist first.
  topic_preview: false,

  agent_onboarding: isDev,
  dev_dock: isDev,
  auth_captcha: true,
  cloud_promotion: false,
  onboarding_v2: isDev,
  // Cloud-only grayscale for the new subscription tiers: off until an admin
  // publishes a whitelist (array of user IDs) or flips it to true.
  mobile_new_tier_sales: false,
  // Server-only: Cloud lets a store sandbox purchase grant entitlement only for user IDs listed
  // explicitly; `true` and percentage rollout count as off, and it never reaches the client state.
  mobile_sandbox_grant: false,

  market: true,
  speech_to_text: true,
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
    isAgentEditable: evaluateFeatureFlag(config.edit_agent, userId, 'edit_agent'),

    enableAgentShare: evaluateFeatureFlag(config.agent_share, userId, 'agent_share'),
    // Deprecated compatibility field for released LobeHub Mobile clients; see IFeatureFlagsState.
    enableGatewayMuxMobile: ENABLE_BUSINESS_FEATURES,
    enableLlmRelay: evaluateFeatureFlag(config.agent_llm_relay, userId, 'agent_llm_relay'),
    enableDeferredInit: evaluateFeatureFlag(
      config.agent_deferred_init,
      userId,
      'agent_deferred_init',
    ),
    enableDeferredHeteroDispatch: evaluateFeatureFlag(
      config.agent_deferred_hetero_dispatch,
      userId,
      'agent_deferred_hetero_dispatch',
    ),
    enableStripOperationToolset: evaluateFeatureFlag(
      config.agent_runtime_strip_operation_toolset,
      userId,
      'agent_runtime_strip_operation_toolset',
    ),
    enableDashboard: evaluateFeatureFlag(config.dashboard, userId, 'dashboard'),
    enableMcpApps: evaluateFeatureFlag(config.mcp_apps, userId, 'mcp_apps'),
    enableAgentKnowledgeSpace: evaluateFeatureFlag(
      config.agent_knowledge_space,
      userId,
      'agent_knowledge_space',
    ),
    enableImLayout: evaluateFeatureFlag(config.im_layout, userId, 'im_layout'),
    enableChannels: evaluateFeatureFlag(config.channel, userId, 'channel'),
    enableManagedCloudDevice: evaluateFeatureFlag(
      config.managed_cloud_device,
      userId,
      'managed_cloud_device',
    ),
    enableTopicPreview: evaluateFeatureFlag(config.topic_preview, userId, 'topic_preview'),
    showProvider: evaluateFeatureFlag(config.provider_settings, userId, 'provider_settings'),

    showOpenAIApiKey: evaluateFeatureFlag(config.openai_api_key, userId, 'openai_api_key'),
    showOpenAIProxyUrl: evaluateFeatureFlag(config.openai_proxy_url, userId, 'openai_proxy_url'),

    showApiKeyManage: evaluateFeatureFlag(config.api_key_manage, userId, 'api_key_manage'),

    showAiImage: evaluateFeatureFlag(config.ai_image, userId, 'ai_image'),
    showChangelog: evaluateFeatureFlag(config.changelog, userId, 'changelog'),

    enableCheckUpdates: evaluateFeatureFlag(config.check_updates, userId, 'check_updates'),
    showWelcomeSuggest: evaluateFeatureFlag(config.welcome_suggest, userId, 'welcome_suggest'),

    enableKnowledgeBase: evaluateFeatureFlag(config.knowledge_base, userId, 'knowledge_base'),
    enableRAGEval: evaluateFeatureFlag(config.rag_eval, userId, 'rag_eval'),
    enableAgentOnboarding: evaluateFeatureFlag(config.agent_onboarding, userId, 'agent_onboarding'),
    enableDevDock: evaluateFeatureFlag(config.dev_dock, userId, 'dev_dock'),
    enableAuthCaptcha: evaluateFeatureFlag(config.auth_captcha, userId, 'auth_captcha'),
    enableOnboardingV2: evaluateFeatureFlag(config.onboarding_v2, userId, 'onboarding_v2'),
    // Deprecated constant for released desktop clients; see IFeatureFlagsState.
    enableNewTierPlans: true,
    enableMobileNewTierSales: evaluateFeatureFlag(
      config.mobile_new_tier_sales,
      userId,
      'mobile_new_tier_sales',
    ),

    showCloudPromotion: evaluateFeatureFlag(config.cloud_promotion, userId, 'cloud_promotion'),
    // Deprecated compatibility field for released LobeHub Mobile clients; see IFeatureFlagsState.
    enableWorkspace: ENABLE_BUSINESS_FEATURES,

    showMarket: evaluateFeatureFlag(config.market, userId, 'market'),
    enableSTT: evaluateFeatureFlag(config.speech_to_text, userId, 'speech_to_text'),
    // Deprecated compatibility field for released LobeHub Mobile clients; see IFeatureFlagsState.
    enableVoiceDictation: ENABLE_BUSINESS_FEATURES,

    hideGitHub: evaluateFeatureFlag(
      config.commercial_hide_github,
      userId,
      'commercial_hide_github',
    ),
    hideDocs: evaluateFeatureFlag(config.commercial_hide_docs, userId, 'commercial_hide_docs'),
  };
};

export type { IFeatureFlagsState };

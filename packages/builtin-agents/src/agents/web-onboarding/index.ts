import { UserInteractionIdentifier } from '@lobechat/builtin-tool-user-interaction';
import { AgentMarketplaceIdentifier } from '@lobechat/builtin-tool-web-onboarding/agentMarketplace';
import { DEFAULT_ONBOARDING_MODEL, DEFAULT_ONBOARDING_PROVIDER } from '@lobechat/business-const';

import type { BuiltinAgentDefinition } from '../../types';
import { BUILTIN_AGENT_SLUGS } from '../../types';
import { createSystemRole } from './systemRole';

/** Must match `WebOnboardingIdentifier` in `packages/builtin-tool-web-onboarding/src/types.ts`. */
const WebOnboardingIdentifier = 'lobe-web-onboarding';

export const WEB_ONBOARDING: BuiltinAgentDefinition = {
  avatar: '/avatars/lobe-ai.png',
  persist: {
    model: DEFAULT_ONBOARDING_MODEL,
    provider: DEFAULT_ONBOARDING_PROVIDER,
  },
  runtime: (ctx) => ({
    chatConfig: {
      memory: {
        enabled: false,
      },
      runtimeEnv: {
        runtimeMode: {
          desktop: 'none',
          web: 'none',
        },
      },
      searchMode: 'off',
      skillActivateMode: 'manual',
    },
    plugins: [
      WebOnboardingIdentifier,
      UserInteractionIdentifier,
      AgentMarketplaceIdentifier,
      ...(ctx.plugins || []),
    ],
    systemRole: createSystemRole(ctx.userLocale, { isDev: ctx.isDev }),
  }),
  slug: BUILTIN_AGENT_SLUGS.webOnboarding,
};

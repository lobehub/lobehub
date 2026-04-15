import { AgentManagementIdentifier } from '@lobechat/builtin-tool-agent-management';
import { GroupAgentBuilderIdentifier } from '@lobechat/builtin-tool-group-agent-builder';
import { UserInteractionIdentifier } from '@lobechat/builtin-tool-user-interaction';
import { DEFAULT_PROVIDER } from '@lobechat/business-const';
import { DEFAULT_ONBOARDING_MODEL } from '@lobechat/const';

import type { BuiltinAgentDefinition } from '../../types';
import { BUILTIN_AGENT_SLUGS } from '../../types';
import { createSystemRole } from './systemRole';

/** Must match `WebOnboardingIdentifier` in `packages/builtin-tool-web-onboarding/src/types.ts`. */
const WebOnboardingIdentifier = 'lobe-web-onboarding';

export const WEB_ONBOARDING: BuiltinAgentDefinition = {
  avatar: '/avatars/lobe-ai.png',
  persist: {
    model: DEFAULT_ONBOARDING_MODEL,
    provider: DEFAULT_PROVIDER,
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
      AgentManagementIdentifier,
      GroupAgentBuilderIdentifier,
      ...(ctx.plugins || []),
    ],
    systemRole: createSystemRole(ctx.userLocale, { isDev: ctx.isDev }),
  }),
  slug: BUILTIN_AGENT_SLUGS.webOnboarding,
};

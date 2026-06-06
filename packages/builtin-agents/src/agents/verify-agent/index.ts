import { VerifyToolIdentifier } from '@lobechat/builtin-tool-verify';
import { DEFAULT_PROVIDER } from '@lobechat/business-const';
import { DEFAULT_MODEL } from '@lobechat/const';

import type { BuiltinAgentDefinition } from '../../types';
import { BUILTIN_AGENT_SLUGS } from '../../types';
import { systemRoleTemplate } from './systemRole';

export const VERIFY_AGENT: BuiltinAgentDefinition = {
  avatar: '/avatars/lobe-ai.png',
  persist: {
    // Chat mode = strict tool whitelist: the verifier gets ONLY its writeback
    // tool, not the default agent toolset (web/sandbox/skills), so it judges and
    // submits instead of wandering off investigating. Search off for the same reason.
    chatConfig: {
      enableAgentMode: false,
      searchMode: 'off',
    },
    model: DEFAULT_MODEL,
    provider: DEFAULT_PROVIDER,
  },
  runtime: (ctx) => ({
    // Only the verify-result tool — plus any investigation tools the run injects
    // (e.g. file/search tools). No document/plan tools by default.
    plugins: [VerifyToolIdentifier, ...(ctx.plugins || [])],
    systemRole: systemRoleTemplate,
  }),
  slug: BUILTIN_AGENT_SLUGS.verifyAgent,
};

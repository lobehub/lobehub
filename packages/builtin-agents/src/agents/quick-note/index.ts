import { DEFAULT_MINI_PROVIDER } from '@lobechat/business-const';
import { DEFAULT_MINI_MODEL } from '@lobechat/const';

import type { BuiltinAgentDefinition } from '../../types';
import { BUILTIN_AGENT_SLUGS } from '../../types';

/**
 * Tools the Quick Note agent works with: web search for background, and `lobe-agent` for
 * `analyzeMedia` on images attached to a note. Custom tool mode mounts exactly these.
 */
export const QUICK_NOTE_AGENT_PLUGINS = ['lobe-web-browsing', 'lobe-agent'];

/**
 * Produces the summary, tags, related resources, and delegate drafts for a judged Quick Note,
 * and runs the Tasks a Quick Note starts when no analyze agent is configured.
 */
export const QUICK_NOTE_ANALYZE: BuiltinAgentDefinition = {
  avatar: '/avatars/lobe-ai.png',
  persist: {
    chatConfig: { enableAgentMode: false, searchMode: 'auto', toolMode: 'custom' },
    description: 'Adds lightweight context, labels, and optional proposals to saved Quick Notes.',
    model: DEFAULT_MINI_MODEL,
    provider: DEFAULT_MINI_PROVIDER,
    title: 'Quick Note Analyzer',
  },
  runtime: {
    agencyConfig: { executionTarget: 'none' },
    chatConfig: {
      enableAgentMode: false,
      memory: { enabled: false },
      searchMode: 'auto',
      toolMode: 'custom',
    },
    plugins: QUICK_NOTE_AGENT_PLUGINS,
    systemRole:
      "You are the Quick Note Agent. You work on the user's quick notes: you add context, and you carry out the research the user hands off from a note. Ground claims in sources you found and say what you could not verify.",
  },
  slug: BUILTIN_AGENT_SLUGS.quickNoteAnalyze,
  userConfigurable: true,
};

export { quickNoteAnalyzeProtocol } from './analyzeSystemRole';

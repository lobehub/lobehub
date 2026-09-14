import { DEFAULT_MINI_PROVIDER } from '@lobechat/business-const';
import { DEFAULT_MINI_MODEL } from '@lobechat/const';

import type { BuiltinAgentDefinition } from '../../types';
import { BUILTIN_AGENT_SLUGS } from '../../types';
import { diveSystemRole } from './diveSystemRole';

/**
 * Produces bounded tags, Annotation text, and related Document selections.
 */
export const QUICK_NOTE_ANALYZE: BuiltinAgentDefinition = {
  avatar: '/avatars/lobe-ai.png',
  persist: {
    chatConfig: { enableAgentMode: false, searchMode: 'off', toolMode: 'custom' },
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
      searchMode: 'off',
      toolMode: 'custom',
    },
    plugins: [],
    systemRole: 'You are the Quick Note Analyze Agent.',
  },
  slug: BUILTIN_AGENT_SLUGS.quickNoteAnalyze,
  userConfigurable: true,
};

export { quickNoteAnalyzeProtocol } from './analyzeSystemRole';

/**
 * Orchestrates an explicit Dive and delegates specialist work to Domain Agents.
 */
export const QUICK_NOTE_DIVE: BuiltinAgentDefinition = {
  avatar: '/avatars/lobe-ai.png',
  runtime: (context) => ({
    plugins: ['lobe-agent', ...(context.plugins ?? [])],
    systemRole: diveSystemRole,
  }),
  slug: BUILTIN_AGENT_SLUGS.quickNoteDive,
};

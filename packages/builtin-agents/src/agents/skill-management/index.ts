import { DEFAULT_MINI_PROVIDER } from '@lobechat/business-const';
import { DEFAULT_MINI_MODEL } from '@lobechat/const';

import type { BuiltinAgentDefinition } from '../../types';
import { BUILTIN_AGENT_SLUGS } from '../../types';

/**
 * Skill-Management Agent — runs after a turn when user feedback is routed to the
 * skill domain (a reusable procedure / workflow the agent should perform
 * consistently). It inspects existing managed skills and applies one safe skill
 * create/refine, or does nothing.
 *
 * Tool surface (`agent-signal-skill-management`) is the skill-only resource
 * subset (skill reads + createSkillIfAbsent / replaceSkillContentCAS), wired
 * server-side via its serverRuntime.
 */
export const SKILL_MANAGEMENT: BuiltinAgentDefinition = {
  // Background self-iteration runs on the cheap mini system model, not the
  // user's default chat model.
  persist: {
    model: DEFAULT_MINI_MODEL,
    provider: DEFAULT_MINI_PROVIDER,
  },
  runtime: {
    plugins: ['agent-signal-skill-management'],
    systemRole:
      'You are the same-turn skill-management agent. Inspect existing managed skills and turn reusable-procedure feedback into exactly one durable skill create/refine, or do nothing. Be concise and evidence-driven.',
  },
  slug: BUILTIN_AGENT_SLUGS.skillManagement,
};

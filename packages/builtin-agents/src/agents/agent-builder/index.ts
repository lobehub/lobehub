import { AgentBuilderIdentifier } from '@lobechat/builtin-tool-agent-builder';
import { DEFAULT_PROVIDER } from '@lobechat/business-const';
import { DEFAULT_MODEL } from '@lobechat/const';

import type { BuiltinAgentDefinition } from '../../types';
import { BUILTIN_AGENT_SLUGS } from '../../types';
import { systemRoleTemplate } from './systemRole';

/**
 * Builtin tools that conflict with the Agent Builder when they coexist in the
 * same conversation. In Agent Builder mode the Agent Builder tool is the SOLE
 * authority for editing the agent being configured, so these agent-editing /
 * orchestration tools are stripped from `ctx.plugins`:
 *
 * - `lobe-agent-management`: duplicate edit APIs (updatePrompt / updateAgent /
 *   installPlugin) PLUS a `<self_management>` prompt whose `<current_agent>`
 *   points at the builder ITSELF and tells the model to "prefer Agent Management
 *   and modify the current agent (yourself)". With both toolsets present this is
 *   what makes an ambiguous "help me change ..." edit the builder's own config
 *   instead of the agent on the left.
 * - `lobe-group-management` / `lobe-group-agent-builder`: group agent CRUD /
 *   callAgent — a second, overlapping "edit/orchestrate agents" surface.
 * - `lobe-agent`: sub-agent dispatch / planning / todos — orchestration noise
 *   that competes with the builder's single "configure this agent" job.
 *
 * Functional plugins the edited agent carries (web browsing, image generation,
 * Gmail / Composio integrations, marketplace MCP, etc.) are intentionally kept —
 * the builder may still use them, and only the conflicting tools above are
 * removed. Identifiers are the stable persisted plugin ids (see each tool's
 * `*Identifier`); using literals here mirrors `EXCLUDED_TOOLS` in the tool-store
 * selectors and avoids pulling extra package deps into builtin-agents.
 */
const AGENT_BUILDER_CONFLICTING_TOOLS = new Set<string>([
  'lobe-agent-management',
  'lobe-group-management',
  'lobe-group-agent-builder',
  'lobe-agent',
]);

/**
 * Agent Builder - used for configuring AI agents through natural conversation
 */
export const AGENT_BUILDER: BuiltinAgentDefinition = {
  avatar: '/avatars/agent-builder.png',

  // Persist config - stored in database
  persist: {
    model: DEFAULT_MODEL,
    provider: DEFAULT_PROVIDER,
  },

  // Runtime config - static systemRole
  runtime: (ctx) => ({
    plugins: [
      AgentBuilderIdentifier,
      ...(ctx.plugins || []).filter((id) => !AGENT_BUILDER_CONFLICTING_TOOLS.has(id)),
    ],
    systemRole: systemRoleTemplate,
  }),

  slug: BUILTIN_AGENT_SLUGS.agentBuilder,
};

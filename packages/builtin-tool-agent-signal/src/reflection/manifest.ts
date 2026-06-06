import { AGENT_SIGNAL_REFLECTION_IDENTIFIER } from '../shared/identifiers';
import { createAgentSignalManifest } from '../shared/manifest';
import { REFLECTION_TOOL_APIS, RESOURCE_TOOL_APIS } from '../shared/schemas';
import { systemPrompt } from './systemRole';

/**
 * Post-turn self-reflection tool surface: shared resource tools + the reflection
 * idea / self-feedback-intent recorders. Hidden, server-executed builtin tool.
 */
export const agentSignalReflectionManifest = createAgentSignalManifest({
  apis: [...RESOURCE_TOOL_APIS, ...REFLECTION_TOOL_APIS],
  description: 'Read evidence and apply or downgrade safe resource operations during reflection.',
  identifier: AGENT_SIGNAL_REFLECTION_IDENTIFIER,
  systemRole: systemPrompt,
  title: 'Agent Signal Self-Reflection',
});

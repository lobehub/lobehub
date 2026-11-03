import { AGENT_SIGNAL_FEEDBACK_INTENT_IDENTIFIER } from '../shared/identifiers';
import { createAgentSignalManifest } from '../shared/manifest';
import { REFLECTION_TOOL_APIS, RESOURCE_TOOL_APIS } from '../shared/schemas';
import { systemPrompt } from './systemRole';

/**
 * Self-feedback-intent tool surface. Shares the reflection toolset (resource
 * tools + idea / intent recorders); distinct identity for plugin routing and
 * mode-specific bookkeeping. Hidden, server-executed builtin tool.
 */
export const agentSignalFeedbackIntentManifest = createAgentSignalManifest({
  apis: [...RESOURCE_TOOL_APIS, ...REFLECTION_TOOL_APIS],
  description: 'Read evidence and action or downgrade a declared self-feedback intent.',
  identifier: AGENT_SIGNAL_FEEDBACK_INTENT_IDENTIFIER,
  systemRole: systemPrompt,
  title: 'Agent Signal Self-Feedback Intent',
});

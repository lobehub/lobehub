import { AGENT_SIGNAL_REVIEW_IDENTIFIER } from '../shared/identifiers';
import { createAgentSignalManifest } from '../shared/manifest';
import { RESOURCE_TOOL_APIS, REVIEW_TOOL_APIS } from '../shared/schemas';
import { systemPrompt } from './systemRole';

/**
 * Nightly-review tool surface: shared resource tools + proposal lifecycle + the
 * non-actionable idea recorder. Hidden, server-executed builtin tool.
 */
export const agentSignalReviewManifest = createAgentSignalManifest({
  apis: [...RESOURCE_TOOL_APIS, ...REVIEW_TOOL_APIS],
  description: 'Read evidence and apply safe resource operations for the nightly self-review.',
  identifier: AGENT_SIGNAL_REVIEW_IDENTIFIER,
  systemRole: systemPrompt,
  title: 'Agent Signal Nightly Review',
});

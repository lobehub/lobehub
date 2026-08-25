import { getHeterogeneousAgentConfigOrThrow } from '../config';
import { type ClaudeCompatibleAdapterProfile, ClaudeCompatibleStreamAdapter } from './claudeCode';

const codeBuddyDescriptor = getHeterogeneousAgentConfigOrThrow('codebuddy');

const CODEBUDDY_ADAPTER_PROFILE: ClaudeCompatibleAdapterProfile = {
  agentType: 'codebuddy',
  assistantMessageIdsDefineTurns: false,
  authMessage: codeBuddyDescriptor.auth.errorMessage,
  authRequiredPatterns: codeBuddyDescriptor.auth.patterns.map(
    (pattern) => new RegExp(pattern, 'i'),
  ),
  docsUrl: codeBuddyDescriptor.auth.docsUrl,
  enableClaudeErrorClassifiers: false,
  enableClaudeTaskState: false,
  errorSubtypeMessages: {
    error_during_execution: 'CodeBuddy hit an error mid-run and exited without reporting a reason.',
    error_max_turns: 'CodeBuddy stopped after reaching its maximum number of turns for this run.',
  },
  ignoreDuplicateInit: true,
};

export class CodeBuddyAdapter extends ClaudeCompatibleStreamAdapter {
  constructor() {
    super({}, CODEBUDDY_ADAPTER_PROFILE);
  }
}

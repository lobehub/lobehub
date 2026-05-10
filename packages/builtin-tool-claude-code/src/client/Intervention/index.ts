import type { BuiltinIntervention } from '@lobechat/types';

import { ClaudeCodeApiName } from '../../types';
import AskUserQuestionIntervention from './AskUserQuestion';

/**
 * Claude Code Intervention components.
 *
 * Currently only `askUserQuestion` (CC's clarifying-question MCP tool) needs
 * one. Approval / file-picker etc. would slot in alongside.
 */
export const ClaudeCodeInterventions: Record<string, BuiltinIntervention> = {
  [ClaudeCodeApiName.AskUserQuestion]: AskUserQuestionIntervention as BuiltinIntervention,
};

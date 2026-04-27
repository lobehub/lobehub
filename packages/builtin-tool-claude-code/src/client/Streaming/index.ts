import type { BuiltinStreaming } from '@lobechat/types';

import { ClaudeCodeApiName } from '../../types';
import AgentStreaming from './Agent';

/**
 * Claude Code Streaming Components Registry.
 *
 * Rendered while a CC tool is still executing (args parsed, no tool_result
 * yet). Without an entry here, the tool detail falls back to the generic
 * `参数列表` argument table. Register only tools whose live state is more
 * useful as bespoke UI than as an arg dump — e.g. `Agent`, where we want to
 * surface the instruction and let the user jump into the subagent thread
 * while the subagent is still running.
 */
export const ClaudeCodeStreamings: Record<string, BuiltinStreaming> = {
  [ClaudeCodeApiName.Agent]: AgentStreaming as BuiltinStreaming,
};

export { default as AgentStreaming } from './Agent';

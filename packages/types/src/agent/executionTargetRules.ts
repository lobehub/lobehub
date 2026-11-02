import type { AgentContextMode, LobeAgentChatConfig } from './chatConfig';

/**
 * Tool-resolution mode: an explicit `toolMode` wins; otherwise derive from
 * `enableAgentMode` (undefined = agent). `custom` = the toolset is exactly the
 * agent's plugins.
 */
export const resolveToolMode = (
  chatConfig: Pick<LobeAgentChatConfig, 'enableAgentMode' | 'toolMode'> | undefined | null,
): 'agent' | 'chat' | 'custom' =>
  chatConfig?.toolMode ?? (chatConfig?.enableAgentMode === false ? 'chat' : 'agent');

export interface ResolveContextModeOptions {
  /** Whether the effective model supports native function calling. */
  supportToolUse: boolean;
}

/**
 * Resolve the context strategy without changing the legacy tool-mode matrix.
 * On-demand is opt-in and only valid together with an effective agent tool mode
 * and a model that supports function calling; every other combination safely
 * falls back to the legacy default context behaviour.
 */
export const resolveContextMode = (
  chatConfig:
    Pick<LobeAgentChatConfig, 'contextMode' | 'enableAgentMode' | 'toolMode'> | undefined | null,
  { supportToolUse }: ResolveContextModeOptions,
): AgentContextMode =>
  chatConfig?.contextMode === 'on-demand' &&
  resolveToolMode(chatConfig) === 'agent' &&
  supportToolUse === true
    ? 'on-demand'
    : 'default';

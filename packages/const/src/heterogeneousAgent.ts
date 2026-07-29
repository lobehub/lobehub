/** Model instruction used when resuming an interrupted Claude Code or Codex session. */
export const HETERO_CONTINUE_PROMPT =
  'Continue the task from where it stopped. The transcript above shows the work already completed — do not redo it.';

/**
 * Legacy heterogeneous-agent model IDs. Before `agencyConfig.heterogeneousProvider`
 * existed, an agent was routed to the external-CLI / device execution path purely
 * by its `model` matching one of these. `AiAgentService` still honors this fallback,
 * so a stray `model: 'claude-code'` alone makes an agent heterogeneous — any guard
 * that keeps an agent on the cloud path must sanitize the model too, not just the
 * provider config.
 */
export const HETEROGENEOUS_AGENT_MODEL_IDS = ['amp', 'claude-code', 'codex', 'opencode'] as const;

const HETEROGENEOUS_AGENT_MODEL_ID_SET = new Set<string>(HETEROGENEOUS_AGENT_MODEL_IDS);

/** Whether a bare `model` value identifies a legacy heterogeneous agent runtime. */
export const isHeterogeneousAgentModelId = (model?: string | null): boolean =>
  !!model && HETEROGENEOUS_AGENT_MODEL_ID_SET.has(model);

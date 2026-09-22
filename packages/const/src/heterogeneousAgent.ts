/** Model instruction used when resuming an interrupted Claude Code or Codex session. */
export const HETERO_CONTINUE_PROMPT =
  'Continue the task from where it stopped. The transcript above shows the work already completed — do not redo it.';

/**
 * Model instruction for a run cut off by a desktop restart. The transcript on
 * disk already holds every step up to the cut, and the interrupted tool call
 * is answered with the CLI's own "[Request interrupted]" marker, so the model
 * only needs to be told why it stopped and to pick up rather than start over.
 */
export const HETERO_RESTART_CONTINUE_PROMPT =
  'The LobeHub desktop app hosting this session was restarted while you were working, which interrupted your previous turn. Continue the task from where it stopped — the transcript above shows the work already completed, do not redo it. If the task was already finished, briefly report the final result instead.';

/**
 * Legacy heterogeneous-agent model IDs. Before `agencyConfig.heterogeneousProvider`
 * existed, an agent was routed to the external-CLI / device execution path purely
 * by its `model` matching one of these. `AiAgentService` still honors this fallback,
 * so a stray `model: 'claude-code'` alone makes an agent heterogeneous — any guard
 * that keeps an agent on the cloud path must sanitize the model too, not just the
 * provider config.
 */
export const HETEROGENEOUS_AGENT_MODEL_IDS = [
  'amp',
  'claude-code',
  'codebuddy',
  'codex',
  'cursor',
  'kimi-code',
  'opencode',
  'pi',
  'qoder',
] as const;

export type HeterogeneousAgentModelId = (typeof HETEROGENEOUS_AGENT_MODEL_IDS)[number];

const HETEROGENEOUS_AGENT_MODEL_ID_SET = new Set<string>(HETEROGENEOUS_AGENT_MODEL_IDS);

/** Whether a bare `model` value identifies a legacy heterogeneous agent runtime. */
export const isHeterogeneousAgentModelId = (
  model?: string | null,
): model is HeterogeneousAgentModelId => !!model && HETEROGENEOUS_AGENT_MODEL_ID_SET.has(model);

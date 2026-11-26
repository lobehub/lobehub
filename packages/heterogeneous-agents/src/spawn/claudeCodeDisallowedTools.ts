/**
 * Claude Code built-in tools disabled in every LobeHub run, whether spawned
 * through the CLI (`--disallowedTools`) or the Agent SDK (`disallowedTools`).
 *
 * - `AskUserQuestion`: CC's CLI self-injects an `is_error: "Answer questions?"`
 *   tool_result in `-p` mode before the host can surface the questions, so the
 *   model falls back to plain-text prompting anyway.
 * - `Monitor` / `ScheduleWakeup`: can hit the same stuck wakeup path in both
 *   desktop and sandbox runs.
 * - `CronCreate`: its jobs live only in the CC session and fire only while that
 *   session stays idle and open. A LobeHub run exits after its reply, so the
 *   job never fires, yet the model tells the user it scheduled one.
 */
export const CLAUDE_CODE_DISALLOWED_TOOLS = [
  'AskUserQuestion',
  'Monitor',
  'ScheduleWakeup',
  'CronCreate',
] as const;

/**
 * One option on an AskUserQuestion question — `label` is what the user picks,
 * `description` is the supporting text shown alongside.
 */
export interface AskUserQuestionOption {
  description?: string;
  label: string;
}

/**
 * One question in an `AskUserQuestion` invocation — `header` is short, `options`
 * is 2-4 entries, `multiSelect` is opt-in.
 */
export interface AskUserQuestionItem {
  header: string;
  multiSelect?: boolean;
  options: AskUserQuestionOption[];
  question: string;
}

/**
 * `AskUserQuestion` tool arguments — 1-4 questions per call. Shared across the
 * Claude Code intervention and the builtin `user-interaction` / `lobe-agent`
 * clarification surfaces so the model's prompts and the UI stay identical.
 */
export interface AskUserQuestionArgs {
  questions: AskUserQuestionItem[];
}

/**
 * In-progress form state, persisted on the tool message's
 * `pluginState.askUserDraft` so HMR reloads, store re-mounts, and tab switches
 * all keep partial answers around — only a fresh `tool_use` starts blank.
 *
 * Three independent answer slices, kept apart so picks and custom text can
 * coexist on one question (multi-select) and a half-typed escape reply never
 * bleeds into the form payload:
 *   - `picks`   → multi-choice selections, keyed by question text
 *   - `custom`  → per-question "write your own" text, keyed by question text
 *   - `escape*` → the global "Or type directly" box (whole-form bypass)
 *
 * Declared as a `type` (not `interface`) so it satisfies the
 * `Record<string, unknown>` param of the store's `setInterventionDraft` — an
 * interface has no implicit index signature and would fail that assignment.
 */
export type AskUserDraft = {
  custom: Record<string, string>;
  escapeActive: boolean;
  escapeText: string;
  picks: Record<string, string | string[]>;
};

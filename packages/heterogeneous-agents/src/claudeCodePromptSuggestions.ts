/**
 * Claude Code's native next-prompt suggestions (`--prompt-suggestions`).
 *
 * Browser-safe: the renderer decides whether a run asks for suggestions, and
 * the desktop host, which knows the installed CLI version, keeps the flag only
 * when that CLI understands it.
 */

/** The `=` form stops the flag's optional value from swallowing a following positional. */
export const PROMPT_SUGGESTIONS_ARG = '--prompt-suggestions=true';

/** First Claude Code release shipping the flag. An older CLI rejects it and fails the run. */
const PROMPT_SUGGESTIONS_MIN_VERSION = [2, 1, 48] as const;

const isPromptSuggestionsArg = (arg: string) =>
  arg === '--prompt-suggestions' || arg.startsWith('--prompt-suggestions=');

const supportsPromptSuggestions = (cliVersion?: string): boolean => {
  const match = cliVersion?.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return false;

  for (const [index, minimum] of PROMPT_SUGGESTIONS_MIN_VERSION.entries()) {
    const part = Number(match[index + 1]);
    if (part !== minimum) return part > minimum;
  }
  return true;
};

/** Ask for suggestions, leaving a flag the user configured themselves untouched. */
export const withPromptSuggestionArg = (
  args: string[] | undefined,
  enabled: boolean,
): string[] | undefined => {
  if (!enabled || args?.some(isPromptSuggestionsArg)) return args;
  return [...(args ?? []), PROMPT_SUGGESTIONS_ARG];
};

/** Drop the flag LobeHub added when the CLI is too old or its version is unknown. */
export const gatePromptSuggestionArgs = (args: string[], cliVersion?: string): string[] =>
  supportsPromptSuggestions(cliVersion)
    ? args
    : args.filter((arg) => arg !== PROMPT_SUGGESTIONS_ARG);

/** Read a raw `prompt_suggestion` record into its `step_complete` payload. */
export const toPromptSuggestionData = (
  raw: unknown,
): { phase: 'prompt_suggestion'; suggestion: string } | undefined => {
  const value = (raw as { suggestion?: unknown } | null)?.suggestion;
  const suggestion = typeof value === 'string' ? value.trim() : '';
  return suggestion ? { phase: 'prompt_suggestion', suggestion } : undefined;
};

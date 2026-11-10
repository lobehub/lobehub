/** Identifier of the tool that replaces the collapsed connector tools. */
export const CODE_MODE_IDENTIFIER = 'lobe-code-mode';

export const CodeModeApiName = {
  docs: 'docs',
  execute: 'execute',
} as const;

/**
 * Collapse only when at least this many connector tools would otherwise be
 * listed one by one. With a connector or two, the extra `docs` round trip and
 * writing a script cost more than the tool definitions they save.
 */
export const CODE_MODE_MIN_TOOL_COUNT = 20;

/** Wall-clock budget of one `execute` call, tool calls included. */
export const CODE_MODE_SCRIPT_TIMEOUT_MS = 60_000;

/**
 * The outer tool-call timeout of `execute`: the script budget plus room to
 * start the worker and format its result, so the sandbox — not the dispatcher —
 * is the one that reports a timeout.
 */
export const CODE_MODE_EXECUTE_TIMEOUT_MS = CODE_MODE_SCRIPT_TIMEOUT_MS + 15_000;

export const CODE_MODE_MEMORY_LIMIT_MB = 64;

export const CODE_MODE_MAX_TOOL_CALLS = 50;

/** Cap on the text `execute` returns to the model (value and logs together). */
export const CODE_MODE_MAX_RESULT_CHARS = 20_000;

/** Cap on `console.log` output kept from one script. */
export const CODE_MODE_MAX_LOG_CHARS = 8000;

/** One-line summaries in the `docs` listing are cut to this length. */
export const CODE_MODE_SUMMARY_MAX_CHARS = 160;

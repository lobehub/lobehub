'use client';

export interface GithubRunCommandArgs {
  command?: string;
  description?: string;
}

export interface GithubRunCommandState {
  exitCode?: number;
  output?: string;
  stderr?: string;
  stdout?: string;
  success?: boolean;
}

/**
 * Normalize a gh command string by stripping a leading `gh ` prefix if present.
 * The tool's manifest accepts both `gh repo list` and `repo list`.
 */
export const normalizeGhCommand = (command?: string): string => {
  const trimmed = (command || '').trim();
  if (!trimmed) return '';
  if (trimmed === 'gh') return '';
  return trimmed.startsWith('gh ') ? trimmed.slice(3).trimStart() : trimmed;
};

/**
 * Extract the gh subcommand path (e.g. "repo list", "api /repos/...", "issue create")
 * for compact display. Stops at the first flag (token starting with `-`).
 */
export const getGhSubcommand = (command?: string): string => {
  const normalized = normalizeGhCommand(command);
  if (!normalized) return '';

  const tokens = normalized.split(/\s+/);
  const subcommandTokens: string[] = [];
  for (const token of tokens) {
    if (token.startsWith('-')) break;
    subcommandTokens.push(token);
    // Most gh commands are 2-3 tokens deep; cap to keep the chip short.
    if (subcommandTokens.length >= 3) break;
  }
  return subcommandTokens.join(' ');
};

/**
 * Best-effort: detect whether a string is JSON so the render can syntax-highlight
 * the output of `gh api` or `gh ... --json` calls.
 */
export const tryParseJson = (value?: string): unknown | undefined => {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const first = trimmed[0];
  if (first !== '{' && first !== '[') return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
};

export const getGithubOutput = (state?: GithubRunCommandState, fallbackContent?: string): string =>
  state?.output || state?.stdout || fallbackContent || '';

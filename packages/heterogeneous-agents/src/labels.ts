/**
 * Display-name mapping for heterogeneous agent types.
 *
 * Keys mirror the registry keys in `registry.ts` (adapter type). UI layers
 * use this to render user-facing names (e.g. "Claude Code is running")
 * without knowing adapter-specific branding.
 */
export const HETEROGENEOUS_TYPE_LABELS: Record<string, string> = {
  'claude-code': 'Claude Code',
  'codex': 'Codex',
};

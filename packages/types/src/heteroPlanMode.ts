import { applyWorktreeModeDir } from './worktreeMode';

/**
 * Codex collaboration modes the Plan switch
 * moves a native Codex thread between. Plan is not a permission mode: Codex
 * keeps allowing every action either way.
 */
export const CODEX_COLLABORATION_MODES = ['plan', 'default'] as const;

export type CodexCollaborationMode = (typeof CODEX_COLLABORATION_MODES)[number];

export const isCodexCollaborationMode = (value: unknown): value is CodexCollaborationMode =>
  typeof value === 'string' && (CODEX_COLLABORATION_MODES as readonly string[]).includes(value);

/**
 * Device capability an `lh` advertises (next to `codex-app-server-v1`) when it
 * takes the Plan switch: the `--input-json` envelope's `collaborationMode` and
 * the `set_collaboration_mode` control command.
 * An older `lh` ignores both, so the switch is unavailable on its device.
 */
export const CODEX_COLLABORATION_MODE_RUNTIME = 'codex-collaboration-mode-v1';

/**
 * The collaboration mode a topic's Codex run sends, or undefined when the
 * topic never turned Plan on (then nothing is sent, exactly as before the lab).
 */
export const codexCollaborationModeOf = (
  planMode: boolean | null | undefined,
): CodexCollaborationMode | undefined =>
  typeof planMode === 'boolean' ? (planMode ? 'plan' : 'default') : undefined;

/**
 * The "Execute plan / Keep discussing" decision under a Codex plan block: the
 * plan item it belongs to and whether the user put the buttons away.
 */
export interface CodexPlanDecision {
  dismissed: boolean;
  /** The plan item (tool call id) the decision belongs to. */
  itemId: string;
}

/**
 * The per-directory Plan switch a new Codex topic starts with, remembered like
 * the "New worktree" switch (same `getWorktreeModeKey` key, same bucket). Only
 * "on" is stored; off is the default.
 */
export const applyHeteroPlanModeDir = (
  current: readonly string[] | undefined,
  key: string,
  enabled: boolean,
): string[] => applyWorktreeModeDir(current, key, enabled);

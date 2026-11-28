import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';
import type {
  ChatTopicMetadata,
  HeteroPermissionMode,
  HeteroPermissionModeFallback,
} from '@lobechat/types';
import { isHeteroPermissionMode } from '@lobechat/types';

import { resolveClaudeCodePermissionMode } from './mode';

/** `step_complete` phase carrying the mode Claude Code reports it is in. */
export const PERMISSION_MODE_PHASE = 'permission_mode';

export interface PermissionModeReportData {
  /** Why the run is not in the picked mode; null when it is. */
  fallback: HeteroPermissionModeFallback | null;
  permissionMode: HeteroPermissionMode;
  phase: typeof PERMISSION_MODE_PHASE;
}

/**
 * The permission mode a Claude Code record reports: `system:init` at each
 * turn, `system:status` after a switch (the host's, or Claude Code's own when
 * a plan is approved). A mode not offered here (`dontAsk`) reports nothing.
 */
export const readClaudeCodePermissionMode = (
  message: unknown,
): HeteroPermissionMode | undefined => {
  if (typeof message !== 'object' || message === null) return;
  const record = message as Record<string, unknown>;
  if (record.type !== 'system' || (record.subtype !== 'init' && record.subtype !== 'status'))
    return;
  // A sub-agent reports its own session, not the topic's.
  if (record.parent_tool_use_id) return;
  return isHeteroPermissionMode(record.permissionMode) ? record.permissionMode : undefined;
};

export const isPermissionModeReport = (data: unknown): data is PermissionModeReportData =>
  typeof data === 'object' &&
  data !== null &&
  (data as { phase?: unknown }).phase === PERMISSION_MODE_PHASE &&
  isHeteroPermissionMode((data as { permissionMode?: unknown }).permissionMode);

/**
 * The topic patch for a mode report, shared by the server (runs hosted by
 * `lh hetero exec`) and the desktop renderer (local runs). A switch Claude Code
 * made or confirmed becomes the topic's mode; a fallback only records why,
 * keeping the pick, so the topic runs in it again wherever it can.
 */
export const permissionModeReportPatch = (
  report: Pick<PermissionModeReportData, 'fallback' | 'permissionMode'>,
): Pick<ChatTopicMetadata, 'heteroPermissionMode' | 'heteroPermissionModeFallback'> =>
  report.fallback
    ? { heteroPermissionModeFallback: report.fallback }
    : { heteroPermissionMode: report.permissionMode, heteroPermissionModeFallback: null };

/**
 * Turns Claude Code's mode reports into `step_complete` events, one per
 * change. Rides `step_complete` like other advisory phases, so the gateway
 * needs no change and consumers that do not know it ignore it.
 */
export class PermissionModeReporter {
  private last: HeteroPermissionMode | undefined;
  /** Why the session started outside the picked mode; dropped once it leaves that mode. */
  private fallback: HeteroPermissionModeFallback | undefined;

  constructor(
    private readonly operationId: string,
    fallback: HeteroPermissionModeFallback | undefined,
  ) {
    this.fallback = fallback;
  }

  /**
   * The user switched the running session to `mode`. Reports from now on
   * explain against that pick: as root a bypass pick runs as `acceptEdits`
   * with the root fallback, so the topic keeps the pick instead of taking
   * `acceptEdits`. The next report is emitted even if the mode is unchanged.
   */
  requested(mode: HeteroPermissionMode, isRoot: boolean): void {
    this.fallback = resolveClaudeCodePermissionMode(mode, isRoot).fallback;
    this.last = undefined;
  }

  /** The event for a record that reports a new mode, else undefined. */
  observe(message: unknown, stepIndex = 0): AgentStreamEvent | undefined {
    const mode = readClaudeCodePermissionMode(message);
    if (!mode || mode === this.last) return;
    this.last = mode;
    // The root fallback explains only the start mode it replaced. A later
    // `acceptEdits` (a plan approved with accepted edits) is the user's pick.
    if (this.fallback === 'root' && mode !== 'acceptEdits') this.fallback = undefined;
    const data: PermissionModeReportData = {
      fallback: this.fallback ?? null,
      permissionMode: mode,
      phase: PERMISSION_MODE_PHASE,
    };
    return {
      data,
      operationId: this.operationId,
      stepIndex,
      timestamp: Date.now(),
      type: 'step_complete',
    };
  }
}

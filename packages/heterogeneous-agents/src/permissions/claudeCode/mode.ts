import type { HeteroPermissionMode, HeteroPermissionModeFallback } from '@lobechat/types';

/**
 * The mode Claude Code can actually run in: as root, `bypassPermissions` falls
 * back to `acceptEdits`. Pure (the caller says whether it runs as root), so the
 * browser-safe mode report can use it.
 */
export const resolveClaudeCodePermissionMode = (
  mode: HeteroPermissionMode,
  isRoot = false,
): { fallback?: HeteroPermissionModeFallback; mode: HeteroPermissionMode } =>
  isRoot && mode === 'bypassPermissions' ? { fallback: 'root', mode: 'acceptEdits' } : { mode };

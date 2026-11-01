import { type PickerVisibility } from './VisibilityTabs';

export interface PickerScope {
  /**
   * Visibility filter to send with the fetch. `undefined` in personal mode —
   * see below.
   */
  effectiveVisibility?: PickerVisibility;
  /** Explain that a workspace-public agent can only reach workspace resources. */
  showPublicAgentHint: boolean;
  /** Let the member switch between their private drawer and the workspace share. */
  showVisibilityTabs: boolean;
}

/**
 * Decides what the knowledge picker may reach for the active agent.
 *
 * `visibility` is workspace-scoped: `buildWorkspaceWhere` ignores the column in
 * personal mode (`workspace_id IS NULL`), where every row is implicitly private
 * to its owner, and the column defaults to `'public'`. Keying off `visibility`
 * alone therefore reads *every* personal agent as a public workspace agent —
 * showing a hint that asks the user to "publish to workspace" when no workspace
 * exists, and narrowing the fetch to rows that merely happen to carry the
 * default value. Pair it with `workspaceId`, the same predicate
 * `isPublicWorkspaceAgent` uses in `@lobechat/types`.
 */
export const resolvePickerScope = ({
  agentVisibility,
  agentWorkspaceId,
  mode,
}: {
  agentVisibility?: 'private' | 'public';
  agentWorkspaceId?: string | null;
  /** The tab the member picked; only meaningful for a workspace agent. */
  mode: PickerVisibility;
}): PickerScope => {
  // Personal mode: no private/workspace split exists, so no tabs, no hint, and
  // no visibility filter — otherwise a row stored as 'private' would be
  // unreachable with no tab to switch to.
  if (!agentWorkspaceId)
    return {
      effectiveVisibility: undefined,
      showPublicAgentHint: false,
      showVisibilityTabs: false,
    };

  // Public agents can only reference workspace resources. The backend enforces
  // this hard (see agent.getKnowledgeBasesAndFiles) — this just drives the UX.
  if (agentVisibility === 'public')
    return {
      effectiveVisibility: 'public',
      showPublicAgentHint: true,
      showVisibilityTabs: false,
    };

  return {
    effectiveVisibility: mode,
    showPublicAgentHint: false,
    showVisibilityTabs: true,
  };
};

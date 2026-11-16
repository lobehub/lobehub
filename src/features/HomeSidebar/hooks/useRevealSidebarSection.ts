import { useCallback } from 'react';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useGlobalStore } from '@/store/global';
import { type SystemStatus } from '@/store/global/initialState';
import { systemStatusSelectors } from '@/store/global/selectors';

/**
 * Section keys of the home sidebar accordions. Mirrors `GroupKey` in
 * `../Body` — not imported from there to avoid a hooks ⇄ Body import cycle
 * (Body renders sections that consume these hooks).
 */
export type RevealableSidebarSection = 'agent';

/**
 * Compute the system-status patch that makes a sidebar section visible after
 * an action moved content into it: expand the accordion and clear a
 * user-applied section hide. Returns `null` when the section is already
 * fully visible so callers can skip the store write.
 *
 * Why this exists: `sidebarExpandedKeys` is persisted, so a collapsed or
 * hidden Agents section would swallow an agent that "Publish to Workspace" /
 * "Make private" just regrouped, with zero visual feedback — which reads as
 * the agent silently disappearing.
 */
export const buildRevealSidebarSectionPatch = (
  section: RevealableSidebarSection,
  expandedKeys: string[],
  hiddenSections: string[],
): Partial<SystemStatus> | null => {
  const patch: Partial<SystemStatus> = {};

  if (!expandedKeys.includes(section)) patch.sidebarExpandedKeys = [...expandedKeys, section];
  if (hiddenSections.includes(section))
    patch.hiddenSidebarSections = hiddenSections.filter((key) => key !== section);

  return Object.keys(patch).length > 0 ? patch : null;
};

/**
 * Returns a callback that reveals a home-sidebar section (expands the
 * accordion and un-hides it) in the ACTIVE scope — `updateSystemStatus`
 * routes the write into the workspace overlay when inside a workspace, so
 * personal-mode preferences stay untouched.
 *
 * Call it after an action whose result lands in that section (e.g. "Make
 * private" → `private`, "Publish to Workspace" → `agent`); a result the user
 * cannot see is indistinguishable from data loss.
 */
export const useRevealSidebarSection = () => {
  const activeWorkspaceId = useActiveWorkspaceId();

  return useCallback(
    (section: RevealableSidebarSection) => {
      const state = useGlobalStore.getState();
      const expandedKeys = systemStatusSelectors.sidebarExpandedKeys(activeWorkspaceId)(state);
      const hiddenSections = systemStatusSelectors.hiddenSidebarSections(activeWorkspaceId)(state);

      const patch = buildRevealSidebarSectionPatch(section, expandedKeys, hiddenSections);
      if (patch) state.updateSystemStatus(patch);
    },
    [activeWorkspaceId],
  );
};

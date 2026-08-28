import type { GroupPermissionState } from './useGroupPermission';

/** The three copies the access-level row can carry, as a `t()`-assignable union. */
export type GroupAccessDescKey =
  | 'permission.noManagePermission'
  | 'permission.page.groupAccessLevelPrivateHint'
  | 'permission.page.groupGeneralAccessDesc';

export interface GroupPermissionSections {
  /** Copy under the access-level row: private groups get the publish hint. */
  accessDescKey: GroupAccessDescKey;
  /** Hidden when the level failed to load; the error block replaces it. */
  showAccessCard: boolean;
  /** Both rows write to the supervisor agent — no supervisor, no card. */
  showConfigCard: boolean;
  /** Personal (non-workspace) group — nothing to share, so nothing to grade. */
  showPersonalEmpty: boolean;
  /** "Everything here takes effect once you publish it." */
  showPrivateNotice: boolean;
}

/**
 * Which parts of the Group Permission page are shown, and which copy the access
 * row carries.
 *
 * Extracted from the form so the page's shape is asserted directly — in
 * particular that a **private** group keeps the full page (notice + both cards,
 * with the "when shared" tense) exactly like a private Agent, rather than
 * degrading to a stripped-down view. The two halves have independent failure
 * modes: the access level comes from the group's permission row, while the
 * Editable settings come from the supervisor agent, so one can be missing
 * without taking the other down.
 */
export const resolveGroupPermissionSections = (
  state: Pick<
    GroupPermissionState,
    'accessError' | 'canManageAccess' | 'hasSupervisor' | 'isPrivate' | 'isWorkspaceGroup'
  >,
): GroupPermissionSections => {
  const { accessError, canManageAccess, hasSupervisor, isPrivate, isWorkspaceGroup } = state;

  const accessDescKey: GroupAccessDescKey = canManageAccess
    ? isPrivate
      ? 'permission.page.groupAccessLevelPrivateHint'
      : 'permission.page.groupGeneralAccessDesc'
    : 'permission.noManagePermission';

  return {
    accessDescKey,
    showAccessCard: isWorkspaceGroup && !accessError,
    showConfigCard: isWorkspaceGroup && hasSupervisor,
    showPersonalEmpty: !isWorkspaceGroup,
    showPrivateNotice: isWorkspaceGroup && isPrivate,
  };
};

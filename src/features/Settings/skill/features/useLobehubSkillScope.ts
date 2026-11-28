import { useTranslation } from 'react-i18next';

import { useWorkspaceMemberProfiles } from '@/business/client/hooks/useWorkspaceMemberProfiles';
import { useWorkspaces } from '@/business/client/hooks/useWorkspaces';
import { usePermission } from '@/hooks/usePermission';
import { type LobehubSkillServer } from '@/store/tool/slices/lobehubSkillStore/types';

export interface LobehubSkillScope {
  /**
   * Whether the viewer may change what this space is connected to. A LobeHub
   * Skill connection in a workspace serves every member, so only admins may
   * authorize, replace or revoke it; in the personal space this is always true.
   */
  canManage: boolean;
  /** Extra confirm text for disconnecting, naming who else loses the connection. */
  disconnectNote?: string;
  /** Why {@link canManage} is false, for a tooltip. */
  manageReason?: string;
  /** Set when the workspace uses a member's personal authorization. */
  referenceNote?: string;
  /** Who that member is, for an "authorized by" field. */
  sourceName?: string;
}

/**
 * Where a LobeHub Skill connection comes from and who may change it.
 *
 * Inside a workspace the connection is the workspace's own, or — left by the
 * per-workspace migration — a member's personal authorization the workspace
 * keeps using until an admin authorizes it for the workspace. In the personal
 * space a connection may be what such workspaces use, which disconnecting it
 * has to say.
 */
export const useLobehubSkillScope = (
  server: LobehubSkillServer | undefined,
  providerLabel: string,
): LobehubSkillScope => {
  const { t } = useTranslation('setting');
  const { allowed: canManage, reason: manageReason } = usePermission('manage_settings');
  const profiles = useWorkspaceMemberProfiles();
  const workspaces = useWorkspaces();

  const reference = server?.reference;
  const sourceName = reference
    ? (reference.sourceUserId && profiles.get(reference.sourceUserId)?.fullName) ||
      reference.sourceDisplayName ||
      t('tools.lobehubSkill.reference.unknownMember')
    : undefined;

  if (reference && sourceName) {
    return {
      canManage,
      disconnectNote: t('tools.lobehubSkill.reference.disconnectDesc', {
        name: sourceName,
        provider: providerLabel,
      }),
      manageReason,
      referenceNote: t('tools.lobehubSkill.reference.note', { name: sourceName }),
      sourceName,
    };
  }

  const sharedWith = server?.referencedByWorkspaceIds ?? [];
  if (sharedWith.length === 0) return { canManage, manageReason };

  const names = sharedWith.map((id) => workspaces.find((w) => w.id === id)?.name || id);
  return {
    canManage,
    disconnectNote: t('tools.lobehubSkill.disconnectConfirm.sharedWorkspaces', {
      provider: providerLabel,
      workspaces: names.join(t('tools.lobehubSkill.reference.listSeparator')),
    }),
    manageReason,
  };
};

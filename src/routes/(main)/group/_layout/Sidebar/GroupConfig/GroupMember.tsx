'use client';

import { agentDisplayName } from '@lobechat/types';
import { ActionIcon, Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { UserMinus } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AddGroupMemberModal from '@/features/AddAgentMemberModal';
import AgentProfilePopup from '@/features/AgentProfileCard/AgentProfilePopup';
import NavItem from '@/features/NavPanel/components/NavItem';
import { useResourceAccess } from '@/features/ResourcePermission/useResourceAccess';
import UserAvatar from '@/features/User/UserAvatar';
import { useActiveLocation } from '@/hooks/useActiveLocation';
import { usePermission } from '@/hooks/usePermission';
import { useQueryRoute } from '@/hooks/useQueryRoute';
import { useAgentGroupStore } from '@/store/agentGroup';
import { agentGroupSelectors } from '@/store/agentGroup/selectors';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/slices/auth/selectors';

import GroupMemberItem from './GroupMemberItem';

const styles = stylex.create({
  memberTrigger: {
    backgroundColor: { 'default': null, ':is([data-popup-open])': cssVar.colorFillTertiary },
    borderRadius: cssVar.borderRadius,
    transition: `background 0.2s ${cssVar.motionEaseOut}`,
  },
  memberTriggerActive: { backgroundColor: cssVar.colorFillTertiary, backgroundImage: 'none' },
});

interface GroupMemberProps {
  addModalOpen: boolean;
  groupId?: string;
  onAddModalOpenChange: (open: boolean) => void;
}

/**
 * Group member info in Sidebar
 */
const GroupMember = memo<GroupMemberProps>(({ addModalOpen, onAddModalOpenChange, groupId }) => {
  const { t } = useTranslation('chat');
  const { allowed: hasEditPermission, reason } = usePermission('edit_own_content');
  const { canEditResource } = useResourceAccess('agentGroup', groupId);
  const canEdit = hasEditPermission && canEditResource;
  const router = useQueryRoute();
  const location = useActiveLocation();
  const [nickname, username] = useUserStore((s) => [
    userProfileSelectors.nickName(s),
    userProfileSelectors.username(s),
  ]);
  const addAgentsToGroup = useAgentGroupStore((s) => s.addAgentsToGroup);
  const removeAgentFromGroup = useAgentGroupStore((s) => s.removeAgentFromGroup);

  const groupMembers = useAgentGroupStore(agentGroupSelectors.getGroupMembers(groupId || ''));

  const activeTab = useMemo(
    () => new URLSearchParams(location.search).get('tab'),
    [location.search],
  );
  const isProfileRoute = useMemo(() => {
    if (!groupId) return false;
    return location.pathname === `/group/${groupId}/profile`;
  }, [groupId, location.pathname]);

  const handleAddMembers = async (selectedAgents: string[]) => {
    if (!canEdit) return;
    if (!groupId) {
      console.error('No active group to add members to');
      return;
    }

    if (selectedAgents.length > 0) {
      await addAgentsToGroup(groupId, selectedAgents);
    }

    onAddModalOpenChange(false);
  };

  const [removingMemberIds, setRemovingMemberIds] = useState<string[]>([]);

  const withRemovingFlag = async (id: string, task: () => Promise<void>) => {
    setRemovingMemberIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    try {
      await task();
    } finally {
      setRemovingMemberIds((prev) => prev.filter((memberId) => memberId !== id));
    }
  };

  const handleRemoveMember = async (memberId: string) => {
    if (!canEdit) return;
    if (!groupId) return;

    await withRemovingFlag(memberId, () => removeAgentFromGroup(groupId, memberId));
  };

  const handleMemberDoubleClick = (agentId: string) => {
    if (!groupId || !canEdit) return;
    router.push(`/group/${groupId}/profile`, { query: { tab: agentId }, replace: true });
  };

  return (
    <>
      <Flexbox gap={2}>
        {/* User */}
        <NavItem icon={<UserAvatar size={24} />} title={nickname || username || 'User'} />
        {groupId &&
          groupMembers.map((item) => (
            <AgentProfilePopup agent={item} agentId={item.id} groupId={groupId} key={item.id}>
              <div
                {...stylex.props(
                  styles.memberTrigger,
                  isProfileRoute && activeTab === item.id && styles.memberTriggerActive,
                )}
                onDoubleClick={() => handleMemberDoubleClick(item.id)}
              >
                <GroupMemberItem
                  agentId={item.id}
                  avatar={item.avatar || undefined}
                  background={item.backgroundColor ?? undefined}
                  isExternal={!item.virtual}
                  title={agentDisplayName(item, t('defaultSession', { ns: 'common' }))}
                  actions={
                    <ActionIcon
                      danger
                      disabled={!canEdit}
                      icon={UserMinus}
                      loading={removingMemberIds.includes(item.id)}
                      size={'small'}
                      title={canEdit ? t('groupSidebar.members.removeMember') : reason}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveMember(item.id);
                      }}
                    />
                  }
                />
              </div>
            </AgentProfilePopup>
          ))}
      </Flexbox>

      {groupId && (
        <AddGroupMemberModal
          existingMembers={groupMembers.map((member) => member.id)}
          groupId={groupId}
          open={addModalOpen}
          onCancel={() => onAddModalOpenChange(false)}
          onConfirm={handleAddMembers}
        />
      )}
    </>
  );
});

export default GroupMember;

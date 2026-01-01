'use client';

import { ActionIcon, Flexbox } from '@lobehub/ui';
import { UserMinus } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DEFAULT_AVATAR } from '@/const/meta';
import NavItem from '@/features/NavPanel/components/NavItem';
import UserAvatar from '@/features/User/UserAvatar';
import { useAgentGroupStore } from '@/store/agentGroup';
import { agentGroupSelectors } from '@/store/agentGroup/selectors';
import { useChatStore } from '@/store/chat';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/slices/auth/selectors';

import AddGroupMemberModal from '../AddGroupMemberModal';
import AgentProfilePopup from './AgentProfilePopup';
import GroupMemberItem from './GroupMemberItem';

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
  const [nickname, username] = useUserStore((s) => [
    userProfileSelectors.nickName(s),
    userProfileSelectors.username(s),
  ]);
  const addAgentsToGroup = useAgentGroupStore((s) => s.addAgentsToGroup);
  const removeAgentFromGroup = useAgentGroupStore((s) => s.removeAgentFromGroup);
  const toggleThread = useAgentGroupStore((s) => s.toggleThread);
  const togglePortal = useChatStore((s) => s.togglePortal);

  // Get members from store (excluding supervisor)
  const groupMembers = useAgentGroupStore(agentGroupSelectors.getGroupMembers(groupId || ''));

  // const [agentSettingsOpen, setAgentSettingsOpen] = useState(false);
  // const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>();

  const handleAddMembers = async (selectedAgents: string[]) => {
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
    if (!groupId) return;

    await withRemovingFlag(memberId, () => removeAgentFromGroup(groupId, memberId));
  };

  const handleMemberClick = (agentId: string) => {
    toggleThread(agentId);
    togglePortal(true);
  };

  return (
    <>
      <Flexbox gap={2}>
        {/* User */}
        <NavItem icon={<UserAvatar size={24} />} title={nickname || username || 'User'} />
        {groupId &&
          groupMembers.map((item) => (
            <AgentProfilePopup
              agent={item}
              groupId={groupId}
              key={item.id}
              onChat={() => handleMemberClick(item.id)}
            >
              <div>
                <GroupMemberItem
                  actions={
                    <ActionIcon
                      danger
                      icon={UserMinus}
                      loading={removingMemberIds.includes(item.id)}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveMember(item.id);
                      }}
                      size={'small'}
                      title={t('groupSidebar.members.removeMember')}
                    />
                  }
                  avatar={item.avatar || DEFAULT_AVATAR}
                  background={item.backgroundColor ?? undefined}
                  title={item.title || t('defaultSession', { ns: 'common' })}
                />
              </div>
            </AgentProfilePopup>
          ))}
      </Flexbox>

      {groupId && (
        <AddGroupMemberModal
          existingMembers={groupMembers.map((member) => member.id)}
          groupId={groupId}
          onCancel={() => onAddModalOpenChange(false)}
          onConfirm={handleAddMembers}
          open={addModalOpen}
        />
      )}
    </>
  );
});

export default GroupMember;

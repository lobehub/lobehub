'use client';

import { ActionIcon, Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { UserMinus } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';

import { DEFAULT_AVATAR } from '@/const/meta';
import NavItem from '@/features/NavPanel/components/NavItem';
import UserAvatar from '@/features/User/UserAvatar';
import { useQueryRoute } from '@/hooks/useQueryRoute';
import { useAgentGroupStore } from '@/store/agentGroup';
import { agentGroupSelectors } from '@/store/agentGroup/selectors';
import { useChatStore } from '@/store/chat';
import { PortalViewType } from '@/store/chat/slices/portal/initialState';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/slices/auth/selectors';

import AddGroupMemberModal from '../AddGroupMemberModal';
import AgentProfilePopup from './AgentProfilePopup';
import GroupMemberItem from './GroupMemberItem';

const styles = createStaticStyles(({ css, cssVar }) => ({
  memberTrigger: css`
    border-radius: ${cssVar.borderRadius};
    transition: background 0.2s ${cssVar.motionEaseOut};

    &[data-popup-open],
    &[data-active='true'] {
      background: ${cssVar.colorFillTertiary};
    }
  `,
}));

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
  const router = useQueryRoute();
  const location = useLocation();
  const [nickname, username] = useUserStore((s) => [
    userProfileSelectors.nickName(s),
    userProfileSelectors.username(s),
  ]);
  const addAgentsToGroup = useAgentGroupStore((s) => s.addAgentsToGroup);
  const removeAgentFromGroup = useAgentGroupStore((s) => s.removeAgentFromGroup);
  const toggleThread = useAgentGroupStore((s) => s.toggleThread);
  const pushPortalView = useChatStore((s) => s.pushPortalView);

  const groupMembers = useAgentGroupStore(agentGroupSelectors.getGroupMembers(groupId || ''));

  const activeTab = useMemo(() => new URLSearchParams(location.search).get('tab'), [location.search]);
  const isProfileRoute = useMemo(() => {
    if (!groupId) return false;
    return location.pathname === `/group/${groupId}/profile`;
  }, [groupId, location.pathname]);

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
    pushPortalView({ agentId, type: PortalViewType.GroupThread });
  };

  const handleMemberDoubleClick = (agentId: string) => {
    if (!groupId) return;
    router.push(`/group/${groupId}/profile`, { query: { tab: agentId }, replace: true });
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
              <div
                className={styles.memberTrigger}
                data-active={isProfileRoute && activeTab === item.id ? 'true' : undefined}
                onDoubleClick={() => handleMemberDoubleClick(item.id)}
              >
                <GroupMemberItem
                  avatar={item.avatar || DEFAULT_AVATAR}
                  background={item.backgroundColor ?? undefined}
                  isExternal={!item.virtual}
                  title={item.title || t('defaultSession', { ns: 'common' })}
                  actions={
                    <ActionIcon
                      danger
                      icon={UserMinus}
                      loading={removingMemberIds.includes(item.id)}
                      size={'small'}
                      title={t('groupSidebar.members.removeMember')}
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

'use client';

import { ActionIcon, SortableList } from '@lobehub/ui';
import { Settings, UserMinus } from 'lucide-react';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { MemberSelectionModal } from '@/components/MemberSelectionModal';
import { DEFAULT_AVATAR, DEFAULT_SUPERVISOR_AVATAR } from '@/const/meta';
import { useChatStore } from '@/store/chat';
import { chatSelectors } from '@/store/chat/selectors';
import { useChatGroupStore } from '@/store/chatGroup';
import { chatGroupSelectors } from '@/store/chatGroup/selectors';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';
import { LobeGroupSession } from '@/types/session';

import AgentSettings from '../../../features/AgentSettings';
import GroupMemberItem from './GroupMemberItem';

interface GroupMemberProps {
  addModalOpen: boolean;
  currentSession?: LobeGroupSession;
  onAddModalOpenChange: (open: boolean) => void;
  sessionId?: string;
}

/**
 * Group member info in Sidebar
 */
const GroupMember = memo<GroupMemberProps>(
  ({ currentSession, addModalOpen, onAddModalOpenChange, sessionId }) => {
    const { t } = useTranslation('chat');

    const addAgentsToGroup = useChatGroupStore((s) => s.addAgentsToGroup);
    const removeAgentFromGroup = useChatGroupStore((s) => s.removeAgentFromGroup);
    const persistReorder = useChatGroupStore((s) => s.reorderGroupMembers);
    const toggleThread = useChatGroupStore((s) => s.toggleThread);
    const updateGroupConfig = useChatGroupStore((s) => s.updateGroupConfig);
    const togglePortal = useChatStore((s) => s.togglePortal);
    const cancelSupervisorDecision = useChatStore((s) => s.internal_cancelSupervisorDecision);
    const triggerSupervisorDecision = useChatStore((s) => s.internal_triggerSupervisorDecision);

    const isSupervisorLoading = useChatStore(chatSelectors.isSupervisorLoading(sessionId || ''));
    const groupConfig = useChatGroupStore(chatGroupSelectors.getGroupConfig(sessionId || ''));

    const currentUser = useUserStore((s) => ({
      avatar: userProfileSelectors.userAvatar(s),
      name: userProfileSelectors.nickName(s),
    }));

    const [agentSettingsOpen, setAgentSettingsOpen] = useState(false);
    const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>();

    const handleAddMembers = async (
      selectedAgents: string[],
      hostConfig?: { model?: string; provider?: string },
      enableSupervisor?: boolean,
    ) => {
      if (!sessionId) {
        console.error('No active group to add members to');
        return;
      }

      // Update host config if changed
      if (hostConfig !== undefined || enableSupervisor !== undefined) {
        const newConfig: any = {};

        if (enableSupervisor !== undefined) {
          newConfig.enableSupervisor = enableSupervisor;
        }

        if (hostConfig) {
          newConfig.orchestratorModel = hostConfig.model;
          newConfig.orchestratorProvider = hostConfig.provider;
        }

        if (Object.keys(newConfig).length > 0) {
          await updateGroupConfig(newConfig);
        }
      }

      // Add selected agents
      if (selectedAgents.length > 0) {
        await addAgentsToGroup(sessionId, selectedAgents);
      }

      onAddModalOpenChange(false);
    };

    // TODO: fix type
    // @ts-ignore
    const initialMembers = useMemo(() => currentSession?.members ?? [], [currentSession?.members]);
    const [members, setMembers] = useState<any[]>(initialMembers);

    const [removingMemberIds, setRemovingMemberIds] = useState<string[]>([]);

    const withRemovingFlag = async (id: string, task: () => Promise<void>) => {
      setRemovingMemberIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
      try {
        await task();
      } finally {
        setRemovingMemberIds((prev) => prev.filter((memberId) => memberId !== id));
      }
    };

    useEffect(() => {
      setMembers(initialMembers);
    }, [initialMembers]);

    const handleRemoveMember = async (memberId: string) => {
      if (!sessionId) return;

      await withRemovingFlag(memberId, () => removeAgentFromGroup(sessionId, memberId));
    };

    const handleMemberClick = (agentId: string) => {
      toggleThread(agentId);
      togglePortal(true);
    };

    const handleOpenMemberSettings = (agentId: string) => {
      setSelectedAgentId(agentId);
      setAgentSettingsOpen(true);
    };

    const handleAgentSettingsClose = () => {
      setAgentSettingsOpen(false);
      setSelectedAgentId(undefined);
    };

    const handleStopSupervisor = () => {
      if (!sessionId) return;
      cancelSupervisorDecision(sessionId);
    };

    const handleTriggerSupervisor = () => {
      if (!sessionId) return;
      // Manual trigger: topicId stays current (undefined), flag manual=true
      triggerSupervisorDecision(sessionId, undefined, true);
    };

    return (
      <>
        <Flexbox gap={2} padding={6}>
          {/* Supervisor - only show if supervisor is enabled */}
          {groupConfig?.enableSupervisor && (
            <GroupMemberItem
              actions={
                <ActionIcon
                  danger
                  icon={UserMinus}
                  loading={removingMemberIds.includes('orchestrator')}
                  onClick={(e) => {
                    e.stopPropagation();
                    void withRemovingFlag('orchestrator', () =>
                      updateGroupConfig({ enableSupervisor: false }),
                    );
                  }}
                  size={'small'}
                  title={t('groupSidebar.members.removeMember')}
                />
              }
              avatar={DEFAULT_SUPERVISOR_AVATAR}
              generating={isSupervisorLoading}
              generatingTooltip={t('groupSidebar.members.orchestratorThinking')}
              id={'orchestrator'}
              onStopGenerating={handleStopSupervisor}
              onStopGeneratingTooltip={t('groupSidebar.members.stopOrchestrator')}
              onTriggerSupervisor={handleTriggerSupervisor}
              onTriggerSupervisorTooltip={t('groupSidebar.members.triggerOrchestrator')}
              pin
              showActionsOnHover={true}
              title={t('groupSidebar.members.orchestrator')}
            />
          )}

          {/* Current User */}
          <GroupMemberItem
            avatar={currentUser.avatar}
            id={'currentUser'}
            pin
            showActionsOnHover={false}
            title={currentUser.name || ''}
          />

          {Boolean(members && members.length > 0) && (
            <SortableList
              gap={2}
              items={members}
              onChange={async (items: any[]) => {
                setMembers(items);
                if (!sessionId) return;
                const orderedIds = items.map((m) => m.id);
                persistReorder(sessionId, orderedIds).catch(() => {
                  console.error('Failed to persist reorder');
                });
              }}
              renderItem={(item: any) => (
                <GroupMemberItem
                  actions={
                    <>
                      <ActionIcon
                        icon={Settings}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenMemberSettings(item.id);
                        }}
                        size={'small'}
                        title={t('groupSidebar.members.memberSettings')}
                      />
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
                    </>
                  }
                  avatar={item.avatar || DEFAULT_AVATAR}
                  background={item.backgroundColor}
                  id={item.id}
                  onClick={() => handleMemberClick(item.id)}
                  title={item.title || t('defaultSession', { ns: 'common' })}
                />
              )}
              style={{ margin: 0 }}
            />
          )}
        </Flexbox>

        <MemberSelectionModal
          currentHostConfig={{
            enableSupervisor: groupConfig?.enableSupervisor,
            orchestratorModel: groupConfig?.orchestratorModel,
            orchestratorProvider: groupConfig?.orchestratorProvider,
          }}
          // @ts-ignore
          // TODO: fix type
          existingMembers={currentSession?.members?.map((member: any) => member.id) || []}
          groupId={sessionId}
          mode="add"
          onCancel={() => onAddModalOpenChange(false)}
          onConfirm={handleAddMembers}
          open={addModalOpen}
        />

        <AgentSettings
          agentId={selectedAgentId}
          onClose={handleAgentSettingsClose}
          open={agentSettingsOpen}
        />
      </>
    );
  },
);

export default GroupMember;

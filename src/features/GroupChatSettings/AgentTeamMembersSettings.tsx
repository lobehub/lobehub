'use client';

import { ActionIcon, Grid, Tag, Text } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { Plus } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { DEFAULT_AVATAR } from '@/const/meta';
import { useChatGroupStore } from '@/store/chatGroup';
import { chatGroupSelectors } from '@/store/chatGroup/selectors';
import { useSessionStore } from '@/store/session';
import { sessionSelectors } from '@/store/session/selectors';
import { LobeAgentSession, LobeGroupSession, LobeSessionType } from '@/types/session';

import AgentCard from './AgentCard';
import HostMemberCard from './HostMemberCard';

const useStyles = createStyles(({ css }) => ({
  container: css`
    width: 100%;
  `,
}));

const HOST_MEMBER_ID = 'supervisor';

const AgentTeamMembersSettings = memo(() => {
  const { t } = useTranslation('setting');
  const { styles } = useStyles();
  const [loadingAgentId, setLoadingAgentId] = useState<string | null>(null);
  const [isCreatingMember, setIsCreatingMember] = useState(false);

  const activeGroupId = useSessionStore((s) => s.activeId);
  const currentSession = useSessionStore(sessionSelectors.currentSession) as LobeGroupSession;
  const groupConfig = useChatGroupStore(chatGroupSelectors.currentGroupConfig);

  const addAgentsToGroup = useChatGroupStore((s) => s.addAgentsToGroup);
  const removeAgentFromGroup = useChatGroupStore((s) => s.removeAgentFromGroup);
  const updateGroupConfig = useChatGroupStore((s) => s.updateGroupConfig);
  const refreshSessions = useSessionStore((s) => s.refreshSessions);
  const createSession = useSessionStore((s) => s.createSession);

  // Get all agent sessions
  const agentSessions = useSessionStore((s) => {
    const allSessions = s.sessions || [];
    return allSessions.filter(
      (session) => session.type === LobeSessionType.Agent,
    ) as LobeAgentSession[];
  });

  const currentSessionId = useSessionStore((s) => s.activeId);

  const isSupervisorEnabled = Boolean(groupConfig?.enableSupervisor);

  // Get member IDs from current session
  const memberIds = useMemo(() => {
    return currentSession?.members?.map((member: any) => member.id) || [];
  }, [currentSession?.members]);

  // Separate agents into two groups: in group and not in group
  const { agentsInGroup, agentsNotInGroup } = useMemo(() => {
    const inGroup: LobeAgentSession[] = [];
    const notInGroup: LobeAgentSession[] = [];

    agentSessions.forEach((agent) => {
      const agentId = agent.config?.id;
      if (!agentId || agent.id === currentSessionId) return; // Skip current session

      if (memberIds.includes(agentId)) {
        inGroup.push(agent);
      } else {
        notInGroup.push(agent);
      }
    });

    return { agentsInGroup: inGroup, agentsNotInGroup: notInGroup };
  }, [agentSessions, memberIds, currentSessionId]);

  const handleAgentAction = async (agentId: string, action: 'add' | 'remove') => {
    if (!activeGroupId) {
      console.error('No active group to perform action on');
      return;
    }

    // Check if this is the host member
    const isHostMember = agentId === HOST_MEMBER_ID;

    // Set loading state for this specific agent
    setLoadingAgentId(agentId);

    try {
      if (action === 'add') {
        if (isHostMember) {
          // Host toggle updates supervisor flag instead of modifying members
          await updateGroupConfig({ enableSupervisor: true });
        } else {
          await addAgentsToGroup(activeGroupId, [agentId]);
        }
      } else {
        if (isHostMember) {
          // Host toggle updates supervisor flag instead of modifying members
          await updateGroupConfig({ enableSupervisor: false });
        } else {
          await removeAgentFromGroup(activeGroupId, agentId);
        }
      }

      // Refresh session data to reflect the changes
      await refreshSessions();
    } catch (error) {
      console.error(`Failed to ${action} agent ${action === 'add' ? 'to' : 'from'} group:`, error);
    } finally {
      // Clear loading state
      setLoadingAgentId(null);
    }
  };

  const hostOperationLoading = loadingAgentId === HOST_MEMBER_ID;

  const handleHostToggle = (checked: boolean) => {
    handleAgentAction(HOST_MEMBER_ID, checked ? 'add' : 'remove');
  };

  const handleCreateMember = async () => {
    if (!activeGroupId || isCreatingMember) return;

    setIsCreatingMember(true);

    try {
      // Create a virtual assistant
      const sessionId = await createSession(
        {
          config: {
            virtual: true,
          },
          meta: {
            avatar: DEFAULT_AVATAR,
            description: '',
            title: t('settingGroupMembers.defaultAgent'),
          },
        },
        false, // Don't switch to the new session
      );

      // Refresh sessions to get the latest data
      await refreshSessions();

      // Get the agent ID from the created session
      const session = sessionSelectors.getSessionById(sessionId)(useSessionStore.getState());
      if (session && session.type === LobeSessionType.Agent) {
        const agentSession = session as LobeAgentSession;
        const agentId = agentSession.config?.id;

        if (agentId) {
          // Add the agent to the current group
          await addAgentsToGroup(activeGroupId, [agentId]);
          await refreshSessions();
        }
      }
    } catch (error) {
      console.error('Failed to create virtual member:', error);
    } finally {
      setIsCreatingMember(false);
    }
  };

  const groupMemberCount = agentsInGroup.length + (isSupervisorEnabled ? 1 : 0);
  const availableAgentCount = agentsNotInGroup.length + (isSupervisorEnabled ? 0 : 1);

  return (
    <Flexbox className={styles.container} gap={40}>
      {/* Agents in Group Section */}
      <Flexbox gap={24}>
        <Flexbox align={'center'} gap={8} horizontal justify="space-between">
          <Flexbox align={'center'} gap={8} horizontal>
            <Text strong style={{ fontSize: 18 }}>
              {t('settingGroupMembers.groupMembers')}
            </Text>
            <Tag>{groupMemberCount}</Tag>
          </Flexbox>
          <ActionIcon
            icon={Plus}
            loading={isCreatingMember}
            onClick={handleCreateMember}
            title={t('settingGroupMembers.createMember')}
          />
        </Flexbox>
        <Grid gap={16} rows={3}>
          {isSupervisorEnabled && (
            <HostMemberCard checked loading={hostOperationLoading} onToggle={handleHostToggle} />
          )}
          {agentsInGroup.map((agent) => (
            <AgentCard
              agent={agent}
              inGroup={true}
              key={agent.config?.id}
              onAction={handleAgentAction}
              operationLoading={loadingAgentId === agent.config?.id}
            />
          ))}
          {agentsInGroup.length === 0 && !isSupervisorEnabled && (
            <Text style={{ color: '#999', gridColumn: '1 / -1', padding: 40, textAlign: 'center' }}>
              {t('settingGroupMembers.noMembersInGroup')}
            </Text>
          )}
        </Grid>
      </Flexbox>

      {/* Agents not in Group Section */}
      <Flexbox gap={24}>
        <Flexbox align={'center'} gap={8} horizontal>
          <Text strong style={{ fontSize: 18 }}>
            {t('settingGroupMembers.availableAgents')}
          </Text>
          <Tag>{availableAgentCount}</Tag>
        </Flexbox>
        <Grid gap={16} rows={3}>
          {!isSupervisorEnabled && (
            <HostMemberCard
              checked={false}
              loading={hostOperationLoading}
              onToggle={handleHostToggle}
            />
          )}
          {agentsNotInGroup.map((agent) => (
            <AgentCard
              agent={agent}
              inGroup={false}
              key={agent.config?.id}
              onAction={handleAgentAction}
              operationLoading={loadingAgentId === agent.config?.id}
            />
          ))}
          {agentsNotInGroup.length === 0 && isSupervisorEnabled && (
            <Text style={{ color: '#999', gridColumn: '1 / -1', padding: 40, textAlign: 'center' }}>
              {t('settingGroupMembers.noAvailableAgents')}
            </Text>
          )}
        </Grid>
      </Flexbox>
    </Flexbox>
  );
});

export default AgentTeamMembersSettings;

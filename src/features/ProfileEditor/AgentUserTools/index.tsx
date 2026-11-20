'use client';

import { Button } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import SharedAgentTool, { type AgentToolProps } from '@/features/ProfileEditor/AgentTool';
import { type ToolGroupMeta } from '@/features/ProfileEditor/ToolListGroup';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useAgentStore } from '@/store/agent';

import AgentToolList from './AgentToolList';

/**
 * What the agent can act with, as one list per page: its tools and connectors, or its skills.
 * Each row is something the agent has turned on; the library is where they are installed,
 * connected and shared. A connector row also says when the agent signs in with a connection of
 * its own instead of the library's.
 */
const AgentUserTools = memo<AgentToolProps>((props) => {
  const { agentId, ...toolProps } = props;
  const { t } = useTranslation('setting');
  const navigate = useWorkspaceAwareNavigate();
  const inWorkspace = !!useActiveWorkspaceId();
  const activeAgentId = useAgentStore((s) => s.activeAgentId);
  const effectiveAgentId = agentId || activeAgentId || '';

  const isSkills = toolProps.kind === 'skills';
  const group: ToolGroupMeta = {
    extra: (
      <Button
        size={'small'}
        type={'text'}
        onClick={() => navigate(isSkills ? '/settings/skill' : '/settings/connector')}
      >
        {t('settingAgent.tools.manageLibrary')}
      </Button>
    ),
    plain: true,
    title: t(
      isSkills ? 'settingAgent.skillsPage.group.title' : 'settingAgent.toolsPage.group.title',
    ),
  };

  if (isSkills)
    return (
      <SharedAgentTool
        {...toolProps}
        excludeAgentConnectors
        agentId={effectiveAgentId}
        group={group}
        showAuthor={inWorkspace}
        variant={'list'}
      />
    );

  return (
    <AgentToolList agentId={effectiveAgentId} group={group} onOpenDetail={toolProps.onOpenDetail} />
  );
});

AgentUserTools.displayName = 'AgentUserTools';

export default AgentUserTools;

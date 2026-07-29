'use client';

import { Flexbox } from '@lobehub/ui';
import { memo, useMemo } from 'react';

import {
  type WorkspaceDetailContextConfig,
  WorkspaceDetailProvider,
} from '../../workspace/features/DetailProvider';
import WorkspaceAgentList from '../../workspace/features/WorkspaceAgentList';
import WorkspaceGroupList from '../../workspace/features/WorkspaceGroupList';
import WorkspacePluginList from '../../workspace/features/WorkspacePluginList';
import WorkspaceSkillList from '../../workspace/features/WorkspaceSkillList';
import { useOrganizationDetailContext } from './DetailProvider';

const OrganizationContent = memo(() => {
  const {
    agents,
    agentCount,
    agentGroups,
    groupCount,
    mobile,
    plugins,
    skills,
    totalInstalls,
    user,
  } = useOrganizationDetailContext();

  const workspaceConfig = useMemo<WorkspaceDetailContextConfig>(
    () => ({
      agentCount,
      agentGroups,
      agents,
      canEdit: false,
      groupCount,
      mobile,
      plugins,
      skills,
      totalInstalls,
      user,
    }),
    [agentCount, agentGroups, agents, groupCount, mobile, plugins, skills, totalInstalls, user],
  );

  return (
    <WorkspaceDetailProvider config={workspaceConfig}>
      <Flexbox gap={32}>
        <WorkspaceAgentList />
        <WorkspaceGroupList />
        <WorkspaceSkillList />
        <WorkspacePluginList />
      </Flexbox>
    </WorkspaceDetailProvider>
  );
});

export default OrganizationContent;

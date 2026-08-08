'use client';

import { Center, Flexbox, Icon, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { Building2 } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import ListLoading from '@/routes/(main)/community/components/ListLoading';

import {
  type UserDetailContextConfig,
  UserDetailProvider,
} from '../../user/features/DetailProvider';
import { useUserDetail } from '../../user/features/useUserDetail';
import { useWorkspaceDetailContext } from './DetailProvider';
import WorkspaceAgentList from './WorkspaceAgentList';
import WorkspaceGroupList from './WorkspaceGroupList';
import WorkspacePluginList from './WorkspacePluginList';
// Skill upload for organizations is not yet available, so the section is hidden for now.
// import WorkspaceSkillList from './WorkspaceSkillList';

const WorkspaceContent = memo(() => {
  const { t } = useTranslation('discover');
  const workspace = useWorkspaceDetailContext();
  const { canEdit, isLoading, onEditWorkspaceProfile, user } = workspace;

  // The community list cards (UserAgentCard / UserGroupCard / …) are shared with the
  // personal-user profile and read from UserDetailContext. Bridge the workspace context
  // into that shape so the cards render here, with the workspace owner treated as owner.
  const { handleStatusChange } = useUserDetail({ onMutate: workspace.onRefreshProfile });
  const userDetailConfig = useMemo<UserDetailContextConfig>(
    () => ({
      agentCount: workspace.agentCount,
      agentGroups: workspace.agentGroups,
      agents: workspace.agents,
      groupCount: workspace.groupCount,
      isOwner: canEdit,
      mobile: workspace.mobile,
      onStatusChange: canEdit ? handleStatusChange : undefined,
      plugins: workspace.plugins,
      skills: workspace.skills,
      totalInstalls: workspace.totalInstalls,
      user: workspace.user,
    }),
    [workspace, canEdit, handleStatusChange],
  );

  // While the market profile is still resolving we don't yet know whether this
  // workspace has a community profile, so render a skeleton instead of flashing
  // the setup empty-state (which would pop in and then be replaced by content).
  if (!user.namespace && isLoading) return <ListLoading length={4} rows={4} />;

  if (!user.namespace) {
    return (
      <Center height="100%" style={{ minHeight: '42vh' }} width="100%">
        <Flexbox align="center" gap={16} style={{ maxWidth: 420, textAlign: 'center' }}>
          <Icon icon={Building2} size={40} />
          <Flexbox gap={8}>
            <Text as="h2" fontSize={24} style={{ margin: 0 }} weight="bold">
              {t('user.workspaceProfile.setup.empty.title')}
            </Text>
            <Text type="secondary">{t('user.workspaceProfile.setup.empty.description')}</Text>
          </Flexbox>
          {canEdit && onEditWorkspaceProfile && (
            <Button type="primary" onClick={onEditWorkspaceProfile}>
              {t('user.workspaceProfile.setup.save')}
            </Button>
          )}
        </Flexbox>
      </Center>
    );
  }

  return (
    <UserDetailProvider config={userDetailConfig}>
      <Flexbox gap={32}>
        <WorkspaceAgentList />
        <WorkspaceGroupList />
        {/* <WorkspaceSkillList /> */}
        <WorkspacePluginList />
      </Flexbox>
    </UserDetailProvider>
  );
});

export default WorkspaceContent;

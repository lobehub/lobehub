import { agentDisplayName } from '@lobechat/types';
import {
  ActionIcon,
  Block,
  Button,
  confirmModal,
  cssVar,
  DropdownMenu,
  Flexbox,
  Icon,
  Switch,
  Tag,
  Text,
  toast,
  Tooltip,
} from '@lobehub/ui';
import {
  ArrowLeftRightIcon,
  MoreHorizontalIcon,
  PencilLineIcon,
  Trash2Icon,
  UserPlusIcon,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import AgentAvatar from '@/components/AgentAvatar';
import AddAgentMemberModal from '@/features/AddAgentMemberModal';
import AssigneeAgentSelector from '@/features/AgentTasks/features/AssigneeAgentSelector';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';
import type { ProjectDetail } from '@/store/project';
import { useProjectStore } from '@/store/project';

import { directoryAgentName } from '../WorkingDirectories/useDirectoryAgent';
import { openEditMemberModal } from './EditMemberModal';

type ProjectMember = NonNullable<ProjectDetail['agents']>[number];

const rowStyle = (index: number) =>
  index ? { borderTop: `1px solid ${cssVar.colorBorderSecondary}` } : undefined;

export function ProjectMemberSettings({ detail }: { detail: ProjectDetail }) {
  const { t } = useTranslation('project');
  const [inviteOpen, setInviteOpen] = useState(false);
  const addProjectAgents = useProjectStore((s) => s.addProjectAgents);
  const updateProjectAgent = useProjectStore((s) => s.updateProjectAgent);
  const removeProjectAgent = useProjectStore((s) => s.removeProjectAgent);
  const replaceProjectCoordinator = useProjectStore((s) => s.replaceProjectCoordinator);
  const projectId = detail.project.id;
  const canManage = detail.permissions?.canManageMembers ?? false;
  const members = detail.agents ?? [];
  // Other members cannot see a private agent, so a shared project only takes shared ones.
  const isShared = Boolean(detail.project.workspaceId) && detail.project.visibility === 'public';

  const invite = async (agentIds: string[]) => {
    try {
      await addProjectAgents(projectId, agentIds);
      setInviteOpen(false);
      toast.success(t('members.invited', { count: agentIds.length }));
    } catch (error) {
      console.error('Failed to invite project agents', error);
      toast.error(t('members.inviteFailed'));
      throw error;
    }
  };

  const toggle = async (member: ProjectMember, enabled: boolean) => {
    try {
      await updateProjectAgent(projectId, member.agent.id, { enabled });
    } catch (error) {
      console.error('Failed to update project agent', error);
      toast.error(t('members.updateFailed'));
    }
  };

  const remove = (member: ProjectMember) =>
    confirmModal({
      content: t('members.removeConfirmDescription'),
      okButtonProps: { danger: true },
      okText: t('members.remove'),
      onOk: async () => {
        try {
          await removeProjectAgent(projectId, member.agent.id);
        } catch (error) {
          console.error('Failed to remove project agent', error);
          toast.error(t('members.removeFailed'));
        }
      },
      title: t('members.removeConfirmTitle', {
        name: agentDisplayName(member.agent, t('defaultAgent', { ns: 'common' })),
      }),
    });

  /** `coordinator` is absent when the project fell back to LobeAI, which has no member row. */
  const replaceCoordinator = (coordinator: ProjectMember | undefined, agentId: string) => {
    const defaultName = t('defaultAgent', { ns: 'common' });
    const previous = coordinator && agentDisplayName(coordinator.agent, defaultName);
    const agent =
      members.find((member) => member.agent.id === agentId)?.agent ??
      homeAgentListSelectors.getAgentById(agentId)(useHomeStore.getState());
    // LobeAI is offered by the picker but not listed on the home sidebar.
    const isInbox = agentId === builtinAgentSelectors.inboxAgentId(useAgentStore.getState());
    const name =
      directoryAgentName(agent, isInbox, t('inbox.title', { ns: 'chat' })) ?? defaultName;
    const values = { name, previous };
    // The server decides: only a coordinator provisioned for this project is retired.
    const dedicated = Boolean(coordinator && detail.coordinatorRetiresOnReplace);
    confirmModal({
      content: !coordinator
        ? undefined
        : dedicated
          ? t('members.replaceCoordinatorDescription', values)
          : t('members.replaceCoordinatorKeepDescription', values),
      okButtonProps: { danger: dedicated },
      okText: t('members.replaceCoordinatorOk'),
      onOk: async () => {
        try {
          await replaceProjectCoordinator(projectId, agentId);
          toast.success(t('members.replaceCoordinatorSuccess', values));
        } catch (error) {
          console.error('Failed to replace project main agent', error);
          toast.error(t('members.replaceCoordinatorFailed'));
        }
      },
      title: t('members.replaceCoordinatorTitle', values),
    });
  };

  const coordinatorMember = members.find(
    (member) => member.agent.id === detail.project.coordinatorAgentId,
  );
  const replaceButton = (coordinator?: ProjectMember) => (
    <AssigneeAgentSelector
      allowUnassigned={false}
      currentAgentId={detail.project.coordinatorAgentId}
      taskVisibility={isShared ? 'public' : null}
      onChange={(agentId) => agentId && replaceCoordinator(coordinator, agentId)}
    >
      <Button icon={ArrowLeftRightIcon} size={coordinator ? 'small' : undefined}>
        {t('members.replaceCoordinator')}
      </Button>
    </AssigneeAgentSelector>
  );

  const inviteButton = (
    <Button
      disabled={!canManage}
      icon={UserPlusIcon}
      type="primary"
      onClick={() => setInviteOpen(true)}
    >
      {t('members.invite')}
    </Button>
  );

  return (
    <Flexbox gap={20}>
      <Flexbox horizontal align="flex-start" gap={16} justify="space-between">
        <Flexbox gap={6}>
          <Text fontSize={16} weight={600}>
            {t('settings.members')}
          </Text>
          <Text type="secondary">{t('members.description')}</Text>
        </Flexbox>
        {canManage ? (
          <Flexbox horizontal gap={8}>
            {!coordinatorMember && replaceButton()}
            {inviteButton}
          </Flexbox>
        ) : (
          <Tooltip title={t('members.manageForbidden')}>
            <span>{inviteButton}</span>
          </Tooltip>
        )}
      </Flexbox>
      <Block padding={0} variant="outlined">
        {members.map((member, index) => {
          const isCoordinator = member.agent.id === detail.project.coordinatorAgentId;
          const name = agentDisplayName(member.agent, t('defaultAgent', { ns: 'common' }));
          return (
            <Flexbox
              horizontal
              align="center"
              gap={12}
              key={member.agent.id}
              padding={16}
              style={rowStyle(index)}
            >
              <AgentAvatar
                agentId={member.agent.id}
                avatar={member.agent.avatar}
                background={member.agent.backgroundColor ?? undefined}
                shape={'circle'}
                size={36}
                title={name}
              />
              <Flexbox flex={1} gap={4} style={{ minWidth: 0 }}>
                <Flexbox horizontal align="center" gap={8}>
                  <Text ellipsis weight={500}>
                    {name}
                  </Text>
                  {isCoordinator ? (
                    <Tag color="primary">{t('directories.coordinator')}</Tag>
                  ) : member.binding.role ? (
                    <Tag>{member.binding.role}</Tag>
                  ) : null}
                </Flexbox>
                <Text ellipsis fontSize={12} type="secondary">
                  {isCoordinator
                    ? t('members.coordinatorResponsibility')
                    : member.binding.responsibility || t('members.noResponsibility')}
                </Text>
              </Flexbox>
              {isCoordinator && canManage && replaceButton(member)}
              {!isCoordinator && canManage && (
                <>
                  <Switch
                    aria-label={t('members.enabled')}
                    size="small"
                    value={member.binding.enabled}
                    onChange={(enabled) => toggle(member, enabled)}
                  />
                  <DropdownMenu
                    items={[
                      {
                        icon: <Icon icon={PencilLineIcon} />,
                        key: 'edit',
                        label: t('members.edit'),
                        onClick: () =>
                          openEditMemberModal({
                            agentId: member.agent.id,
                            projectId,
                            responsibility: member.binding.responsibility,
                            role: member.binding.role,
                            title: name,
                          }),
                      },
                      {
                        danger: true,
                        icon: <Icon icon={Trash2Icon} />,
                        key: 'remove',
                        label: t('members.remove'),
                        onClick: () => remove(member),
                      },
                    ]}
                  >
                    <ActionIcon icon={MoreHorizontalIcon} size="small" title={t('members.more')} />
                  </DropdownMenu>
                </>
              )}
            </Flexbox>
          );
        })}
        {members.length <= 1 && (
          <Flexbox gap={4} padding={16} style={rowStyle(members.length)}>
            <Text type="secondary">{t('members.empty')}</Text>
          </Flexbox>
        )}
      </Block>
      <AddAgentMemberModal
        existingMembers={members.map((member) => member.agent.id)}
        open={inviteOpen}
        sharedOnly={isShared}
        onCancel={() => setInviteOpen(false)}
        onConfirm={invite}
      />
    </Flexbox>
  );
}

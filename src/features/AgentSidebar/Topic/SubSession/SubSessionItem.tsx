'use client';

import { AGENT_CHAT_TOPIC_URL } from '@lobechat/const';
import { ContextMenuTrigger, Icon, toast } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import { Archive, ArrowUpToLine, ListTodo } from 'lucide-react';
import { memo, type MouseEvent, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import AgentAvatar from '@/components/AgentAvatar';
import { TOPIC_STATUS_VISUALS } from '@/components/ExecutionStatus';
import RingLoadingIcon from '@/components/RingLoading';
import { taskDetailPath } from '@/features/AgentTasks/shared/taskDetailPath';
import NavItem from '@/features/NavPanel/components/NavItem';
import { notifyMovedSubSessions } from '@/features/SubSessionRetire/notifyMoved';
import { useRetireTopicWithSubSessions } from '@/features/SubSessionRetire/useRetireTopic';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { buildWorkspaceAwarePath } from '@/features/Workspace/workspaceAwarePath';
import { useChatStore } from '@/store/chat';

import type { SubSessionNode } from './buildSubSessionTree';

const StateIcon = memo<{ state: SubSessionNode['state'] }>(({ state }) => {
  if (state === 'running')
    return <RingLoadingIcon size={14} style={{ color: cssVar.colorWarning }} />;
  if (state === 'waiting_for_user') {
    const visual = TOPIC_STATUS_VISUALS.waitingForHuman;
    return <Icon icon={visual.icon} size={'small'} style={{ color: visual.color }} />;
  }
  if (state === 'failed') {
    const visual = TOPIC_STATUS_VISUALS.failed;
    return <Icon icon={visual.icon} size={'small'} style={{ color: visual.color }} />;
  }
  return null;
});

StateIcon.displayName = 'SubSessionStateIcon';

/**
 * A sub-session nested under its opener. It opens on its own agent's route
 * (`/agent/<agentId>/<topicId>`); one of another agent leads with that agent's
 * avatar. Its menu moves it to the top level, or — for a task run, which
 * belongs to its task — opens the task.
 */
const SubSessionItem = memo<{ node: SubSessionNode; openerAgentId?: string }>(
  ({ node, openerAgentId }) => {
    const { t } = useTranslation(['topic', 'common']);
    const navigate = useWorkspaceAwareNavigate();
    const workspaceSlug = useActiveWorkspaceSlug();
    const active = useChatStore((s) => s.activeTopicId === node.id);
    const detachSubSessions = useChatStore((s) => s.detachSubSessions);
    const retire = useRetireTopicWithSubSessions();
    const markTopicCompleted = useChatStore((s) => s.markTopicCompleted);

    const agentId = node.agentId ?? openerAgentId;
    const crossAgent = !!node.agentId && node.agentId !== openerAgentId;
    const path = agentId ? AGENT_CHAT_TOPIC_URL(agentId, node.id) : undefined;
    const isTaskRun = node.trigger === 'task';

    const open = useCallback(
      (event: MouseEvent) => {
        if (!path || event.metaKey || event.ctrlKey) return;
        event.preventDefault();
        navigate(path);
      },
      [navigate, path],
    );

    const items = useCallback(
      () => [
        isTaskRun
          ? {
              disabled: !node.taskId,
              icon: <Icon icon={ListTodo} />,
              key: 'openInTask',
              label: t('subSession.openInTask'),
              onClick: () => node.taskId && navigate(taskDetailPath(node.taskId)),
            }
          : {
              icon: <Icon icon={ArrowUpToLine} />,
              key: 'detach',
              label: t('subSession.detach'),
              onClick: async () => {
                try {
                  const { detached } = await detachSubSessions([node.id]);
                  notifyMovedSubSessions(detached, (target) => navigate(`/agent/${target}`));
                } catch {
                  toast.error(t('operationFailed', { ns: 'common' }));
                }
              },
            },
        {
          icon: <Icon icon={Archive} />,
          key: 'archive',
          label: t('actions.markCompleted'),
          onClick: () =>
            retire({
              action: 'archive',
              proceed: async () => {
                await markTopicCompleted(node.id);
                await useChatStore.getState().refreshSubSessions();
              },
              title: node.title ?? '',
              topicId: node.id,
            }),
        },
      ],
      [detachSubSessions, isTaskRun, markTopicCompleted, navigate, node, retire, t],
    );

    const icon = crossAgent ? (
      <AgentAvatar
        agentId={node.agentId ?? undefined}
        avatar={node.agent?.avatar ?? undefined}
        background={node.agent?.backgroundColor ?? undefined}
        name={node.agent?.title ?? undefined}
        shape={'circle'}
        size={18}
        title={node.agent?.title ?? undefined}
      />
    ) : (
      <span aria-hidden style={{ flex: 'none', width: 16 }} />
    );

    return (
      <ContextMenuTrigger items={items}>
        <NavItem
          active={active}
          data-testid="sub-session-item"
          extra={<StateIcon state={node.state} />}
          href={path ? buildWorkspaceAwarePath(path, workspaceSlug) : undefined}
          icon={icon}
          title={node.title || t('subSession.untitled')}
          onClick={open}
        />
      </ContextMenuTrigger>
    );
  },
);

SubSessionItem.displayName = 'SubSessionItem';

export default SubSessionItem;

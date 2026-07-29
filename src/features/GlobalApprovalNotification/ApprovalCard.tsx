'use client';

import { AGENT_CHAT_TOPIC_URL, GROUP_CHAT_TOPIC_URL, GROUP_CHAT_URL } from '@lobechat/const';
import { type UIChatMessage } from '@lobechat/types';
import { ActionIcon, Avatar } from '@lobehub/ui';
import { ArrowUpRight } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { ConversationProvider } from '@/features/Conversation';
import InterventionContent from '@/features/Conversation/InterventionBar/InterventionContent';
import InterventionTabBar from '@/features/Conversation/InterventionBar/InterventionTabBar';
import MarkdownMessage from '@/features/Conversation/Markdown';
import { type ConversationContext } from '@/features/Conversation/types';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { buildWorkspaceAwarePath } from '@/features/Workspace/workspaceAwarePath';
import { useOperationState } from '@/hooks/useOperationState';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import { styles } from './styles';
import { type GlobalApprovalGroup } from './useGlobalPendingApprovals';

interface ApprovalCardProps {
  group: GlobalApprovalGroup;
}

/**
 * A single conversation's approval card. Mounts an isolated
 * `ConversationProvider` bound to the run's context so the reused
 * `InterventionContent` (with its built-in approve / reject, edit, and custom
 * intervention UIs) operates on the right conversation without the user having
 * to switch into it.
 */
const ApprovalCard = memo<ApprovalCardProps>(({ group }) => {
  const { context, interventions } = group;
  const { t } = useTranslation('chat');
  const navigate = useWorkspaceAwareNavigate();
  const activeWorkspaceSlug = useActiveWorkspaceSlug();

  const chatKey = useMemo(() => messageMapKey(context), [context]);
  const messages = useChatStore((s) => s.dbMessagesMap[chatKey]);
  const replaceMessages = useChatStore((s) => s.replaceMessages);
  const handleMessagesChange = useCallback(
    (next: UIChatMessage[], ctx: ConversationContext) => {
      replaceMessages(next, { context: ctx });
    },
    [replaceMessages],
  );

  const operationState = useOperationState(context);
  const meta = useAgentStore(agentSelectors.getAgentMetaById(context.agentId));

  // Topic title tells the user *which* conversation this approval belongs to.
  // Read agent-scoped (not active-scoped) so a non-active conversation resolves.
  const topicTitle = useChatStore((s) =>
    context.topicId
      ? topicSelectors
          .getTopicsByAgentId(context.agentId)(s)
          ?.find((tp) => tp.id === context.topicId)?.title
      : undefined,
  );

  const [actionsPortalTarget, setActionsPortalTarget] = useState<HTMLDivElement | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  // Keep the active tab pinned to its toolCallId; fall back to the first when
  // the previously-active intervention is resolved and drops out.
  const activeIndex = useMemo(() => {
    if (activeId) {
      const idx = interventions.findIndex((i) => i.toolCallId === activeId);
      if (idx >= 0) return idx;
    }
    return 0;
  }, [interventions, activeId]);

  const handleTabChange = useCallback(
    (index: number) => {
      setActiveId(interventions[index]?.toolCallId ?? null);
    },
    [interventions],
  );

  const handleGoToConversation = useCallback(() => {
    // Group conversations route under /group/<groupId>; agent runs under
    // /agent/<agentId>/<topicId>. Routing a group approval through the agent URL
    // would land on the agent's 1:1 chat instead of the paused group topic.
    let path: string | undefined;
    if (context.groupId) {
      path = context.topicId
        ? GROUP_CHAT_TOPIC_URL(context.groupId, context.topicId)
        : GROUP_CHAT_URL(context.groupId);
    } else if (context.topicId) {
      path = AGENT_CHAT_TOPIC_URL(context.agentId, context.topicId);
    }
    if (!path) return;
    navigate(buildWorkspaceAwarePath(path, context.workspaceSlug ?? activeWorkspaceSlug), {
      escape: true,
    });
  }, [
    activeWorkspaceSlug,
    context.agentId,
    context.groupId,
    context.topicId,
    context.workspaceSlug,
    navigate,
  ]);

  const canOpenConversation = !!(context.groupId || context.topicId);

  const activeIntervention = interventions[activeIndex];

  // The user request that led to this tool call — shown above the tool so it's
  // clear *what* is being approved. Walk back from the intervention's turn
  // anchor to the nearest user message.
  const userRequest = useMemo(() => {
    if (!messages?.length || !activeIntervention) return '';
    const anchorId = activeIntervention.assistantGroupId ?? activeIntervention.toolMessageId;
    let idx = messages.findIndex((m) => m.id === anchorId);
    if (idx < 0) idx = messages.length - 1;
    for (let i = idx; i >= 0; i -= 1) {
      const m = messages[i];
      if (m.role === 'user' && typeof m.content === 'string' && m.content.trim()) {
        return m.content.trim();
      }
    }
    return '';
  }, [messages, activeIntervention]);

  if (!activeIntervention) return null;

  return (
    <ConversationProvider
      skipFetch
      context={context}
      hasInitMessages={!!messages}
      messages={messages}
      operationState={operationState}
      onMessagesChange={handleMessagesChange}
    >
      <div className={styles.card}>
        <div className={styles.header}>
          <Avatar
            avatar={meta.avatar}
            background={meta.backgroundColor}
            size={28}
            title={meta.title}
          />
          <div className={styles.headerMeta}>
            <div className={styles.headerTitle}>
              {topicTitle || meta.title || t('globalApproval.title')}
            </div>
            <div className={styles.headerSubtitle}>
              {meta.title ? `${meta.title} · ` : ''}
              {t('globalApproval.subtitle')}
            </div>
          </div>
          {canOpenConversation && (
            <ActionIcon
              icon={ArrowUpRight}
              size="small"
              title={t('globalApproval.goToConversation')}
              onClick={handleGoToConversation}
            />
          )}
        </div>

        {userRequest && (
          <div className={styles.userRequest}>
            <span className={styles.userRequestLabel}>{t('globalApproval.userRequestLabel')}</span>
            <div className={styles.userRequestBody}>
              <MarkdownMessage>{userRequest}</MarkdownMessage>
            </div>
          </div>
        )}

        {interventions.length > 1 && (
          <InterventionTabBar
            activeIndex={activeIndex}
            interventions={interventions}
            onTabChange={handleTabChange}
          />
        )}

        <div className={styles.content}>
          <InterventionContent
            actionsPortalTarget={actionsPortalTarget}
            intervention={activeIntervention}
            key={activeIntervention.toolCallId}
          />
        </div>

        <div className={styles.actions} ref={setActionsPortalTarget} />
      </div>
    </ConversationProvider>
  );
});

ApprovalCard.displayName = 'ApprovalCard';

export default ApprovalCard;

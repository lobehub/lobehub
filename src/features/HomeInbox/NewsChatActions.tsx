import { Button, cssVar, Flexbox } from '@lobehub/ui';
import { MessageSquarePlus, Workflow } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { shallow } from 'zustand/shallow';

import { useConversationResourceAccessForTarget } from '@/features/Conversation/hooks/useConversationResourceAccess';
import { useAnalytics } from '@/libs/analytics/client';
import { useTaskStore } from '@/store/task';

interface NewsChatActionsProps {
  agentId: string;
  taskId?: string | null;
  title: string;
  topicId: string;
}

/**
 * The way back into the conversation behind a run-owned brief. Mounted only
 * while the brief is expanded, so the agent's access is resolved for the one
 * row being read rather than for every row in the feed.
 */
const NewsChatActions = memo<NewsChatActionsProps>(({ agentId, taskId, title, topicId }) => {
  const { t } = useTranslation('home');
  const { analytics } = useAnalytics();
  const { openTopicDrawer, setActiveTaskId } = useTaskStore(
    (s) => ({ openTopicDrawer: s.openTopicDrawer, setActiveTaskId: s.setActiveTaskId }),
    shallow,
  );
  // A view-only member can still read the thread, but the drawer gives them no
  // composer — offering "Continue chat" would promise a reply they cannot send.
  // It waits for a resolved grant, so it never flashes in while access loads.
  const { canUseResourceConfirmed } = useConversationResourceAccessForTarget({ agentId });

  const openTopicChat = useCallback(
    (autoFocus: boolean) => {
      const action = autoFocus ? 'continue' : 'view';
      try {
        analytics?.track({
          name: 'home_daily_brief_chat_clicked',
          properties: { action, spm: `homepage.daily_brief.${action}_chat.clicked` },
        });
      } catch {
        // silently ignore tracking errors to avoid affecting business logic
      }
      // setActiveTaskId hydrates the drawer's task context when the brief owns a
      // task and clears any prior drawer state, so openTopicDrawer must come
      // after it for the topic to survive the reset.
      setActiveTaskId(taskId ?? undefined);
      openTopicDrawer(topicId, { agentId, autoFocus, title });
    },
    [agentId, analytics, openTopicDrawer, setActiveTaskId, taskId, title, topicId],
  );

  return (
    <Flexbox horizontal align={'center'} gap={4} justify={'flex-end'}>
      <Button
        icon={Workflow}
        size={'small'}
        style={{ color: cssVar.colorTextSecondary }}
        type={'text'}
        onClick={() => openTopicChat(false)}
      >
        {t('inbox.news.viewChat')}
      </Button>
      {canUseResourceConfirmed && (
        <Button
          icon={MessageSquarePlus}
          size={'small'}
          type={'fill'}
          onClick={() => openTopicChat(true)}
        >
          {t('inbox.news.continueChat')}
        </Button>
      )}
    </Flexbox>
  );
});

NewsChatActions.displayName = 'NewsChatActions';

export default NewsChatActions;

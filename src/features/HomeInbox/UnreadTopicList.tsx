import { AGENT_CHAT_TOPIC_URL } from '@lobechat/const';
import { type ConversationContext } from '@lobechat/types';
import { Avatar, Flexbox, Icon, Markdown, stopPropagation, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ChevronDownIcon, ChevronRightIcon, MessageSquarePlus } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import UnreadDot from '@/components/UnreadDot';
import RunReplyEditor from '@/features/AgentTasks/AgentTaskDetail/RunReplyEditor';
import { useAgentDisplayMeta } from '@/features/AgentTasks/shared/useAgentDisplayMeta';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import Time from '@/routes/(main)/home/features/components/Time';
import { useChatStore } from '@/store/chat';

import AuthorChip from './AuthorChip';
import { type InboxTopic } from './useHomeInboxTopics';

const DOT_WIDTH = 14;
const ROW_GAP = 8;
const ROW_PADDING_INLINE = 14;
const AVATAR_SIZE = 20;

const styles = createStaticStyles(({ css, cssVar }) => ({
  // Line the reply up under the agent that wrote it, not under the unread dot.
  body: css`
    padding-block-end: 12px;
    padding-inline: ${ROW_PADDING_INLINE + DOT_WIDTH + ROW_GAP}px ${ROW_PADDING_INLINE}px;
  `,
  // Keeps the title from shifting left once the dot is gone.
  dotPlaceholder: css`
    flex: none;
    width: ${DOT_WIDTH}px;
  `,
  list: css`
    overflow: hidden;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorBgContainer};
  `,
  row: css`
    cursor: pointer;
    padding-block: 11px;
    padding-inline: ${ROW_PADDING_INLINE}px;
    transition: background ${cssVar.motionDurationFast};

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }
  `,
  section: css`
    &:not(:last-child) {
      border-block-end: 1px solid ${cssVar.colorBorderSecondary};
    }
  `,
}));

interface UnreadTopicItemProps {
  onFollowUpSent?: (topicId: string) => void;
  /** Team view: show who triggered the run, right of the title. */
  showAuthor?: boolean;
  topic: InboxTopic;
}

/**
 * One unread run, collapsed to a single line. Opening it is the read: the last
 * reply drops in inline (up to the server's ~2000-char preview, tail elided with
 * `…`) — no second "show more" step, because the click that opened the row
 * already said "I want to read this". The full thread lives one click deeper, in
 * the topic itself.
 */
const UnreadTopicItem = memo<UnreadTopicItemProps>(({ topic, onFollowUpSent, showAuthor }) => {
  const { t } = useTranslation('home');
  const agent = useAgentDisplayMeta(topic.agentId);
  const navigate = useWorkspaceAwareNavigate();
  const updateTopicStatus = useChatStore((s) => s.updateTopicStatus);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const prefetchMessages = useChatStore((s) => s.prefetchMessages);

  const [expanded, setExpanded] = useState(false);
  const [read, setRead] = useState(false);
  const [replying, setReplying] = useState(false);

  const agentId = topic.agentId ?? undefined;

  // Engaging with the row IS the read: this is an inbox, not a topic list — a row
  // the user has answered or opened has been triaged. The persisted status drops
  // it from the next inbox fetch; locally the row stays put so it doesn't yank
  // out from under the reader.
  const markRead = useCallback(() => {
    if (read) return;
    setRead(true);
    void updateTopicStatus({ agentId, status: 'active', topicId: topic.id });
  }, [agentId, read, topic.id, updateTopicStatus]);

  const toggle = useCallback(() => {
    setExpanded((prev) => {
      if (!prev) markRead();
      return !prev;
    });
  }, [markRead]);

  // Open the run in place — navigate straight into the topic's chat, the same
  // destination the running-topics rows go to, rather than surfacing it in a
  // drawer stacked over the home page.
  const viewChat = useCallback(() => {
    if (!agentId) return;
    markRead();
    navigate(AGENT_CHAT_TOPIC_URL(agentId, topic.id));
  }, [agentId, markRead, navigate, topic.id]);

  // Reply in place, continuing the topic exactly like the chat drawer does:
  // hydrate the topic's messages into the store first so the reply threads onto
  // the last one (without it `sendMessage` reads an empty history and orphans
  // the message — no parentId), then send over the gateway so the run keeps
  // going server-side. No navigation.
  const submitFollowUp = useCallback(
    async (text: string) => {
      if (!agentId) return;
      markRead();
      const context: ConversationContext = {
        agentId,
        isolatedTopic: true,
        scope: 'main',
        topicId: topic.id,
      };
      await prefetchMessages(context);
      await sendMessage({ context, forceRuntime: 'gateway', message: text });
      setReplying(false);
      // Move the row into the running card immediately so the send visibly does
      // something; the hook reconciles with the server a beat later.
      onFollowUpSent?.(topic.id);
    },
    [agentId, markRead, onFollowUpSent, prefetchMessages, sendMessage, topic.id],
  );

  return (
    <Flexbox className={styles.section}>
      <Flexbox horizontal align={'center'} className={styles.row} gap={ROW_GAP} onClick={toggle}>
        {read ? <span className={styles.dotPlaceholder} /> : <UnreadDot />}
        {agent && (
          <Avatar
            avatar={agent.avatar}
            background={agent.backgroundColor}
            shape={'circle'}
            size={AVATAR_SIZE}
            style={{ flex: 'none' }}
            title={agent.title}
          />
        )}
        <Text ellipsis style={{ flex: 1, minWidth: 0 }} weight={read ? 400 : 500}>
          {topic.title}
        </Text>
        {showAuthor && <AuthorChip trigger={topic.trigger} userId={topic.userId} />}
        <Time date={topic.updatedAt ?? topic.createdAt} />
        <Icon
          color={cssVar.colorTextQuaternary}
          icon={expanded ? ChevronDownIcon : ChevronRightIcon}
          size={14}
        />
      </Flexbox>

      {expanded && (
        <Flexbox className={styles.body} gap={8}>
          {topic.lastAssistantMessage && (
            <Markdown style={{ overflow: 'unset' }} variant={'chat'}>
              {topic.lastAssistantMessage}
            </Markdown>
          )}

          {replying ? (
            <Flexbox onClick={stopPropagation}>
              <RunReplyEditor
                placeholder={t('inbox.unread.followUpPlaceholder')}
                onCancel={() => setReplying(false)}
                onSubmit={submitFollowUp}
              />
            </Flexbox>
          ) : (
            <Flexbox horizontal align={'center'} justify={'space-between'}>
              <Button size={'small'} type={'text'} onClick={viewChat}>
                {t('inbox.unread.viewChat')}
              </Button>
              <Button
                disabled={!agentId}
                icon={MessageSquarePlus}
                size={'small'}
                type={'fill'}
                onClick={() => setReplying(true)}
              >
                {t('inbox.unread.followUp')}
              </Button>
            </Flexbox>
          )}
        </Flexbox>
      )}
    </Flexbox>
  );
});

interface UnreadTopicListProps {
  onFollowUpSent?: (topicId: string) => void;
  /** Team view: tag each row with who triggered it. */
  showAuthor?: boolean;
  topics: InboxTopic[];
}

/**
 * Runs that finished while you were away. One line each, like the news list —
 * a week of finished runs still fits on screen, and the reply is one click deep.
 */
const UnreadTopicList = memo<UnreadTopicListProps>(({ topics, onFollowUpSent, showAuthor }) => (
  <Flexbox className={styles.list}>
    {topics.map((topic) => (
      <UnreadTopicItem
        key={topic.id}
        showAuthor={showAuthor}
        topic={topic}
        onFollowUpSent={onFollowUpSent}
      />
    ))}
  </Flexbox>
));

export default UnreadTopicList;

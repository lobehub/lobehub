import { cssVar, Flexbox } from '@lobehub/ui';
import { cssVar as sxVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentContext } from '@/features/Conversation/useAgentContext';
import { useThreadPlacement } from '@/features/Portal/Thread/useThreadPlacement';
import { useFetchActiveTopicDetail } from '@/hooks/useFetchActiveTopicDetail';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { useSessionStore } from '@/store/session';
import { sessionSelectors } from '@/store/session/selectors';

import MemberCountTag from './MemberCountTag';
import ThreadSwitcher from './ThreadSwitcher';

const styles = stylex.create({
  // The way back from a thread opened in the main area: returns to the topic
  // and reopens the thread in the side panel.
  topicLink: {
    backgroundColor: {
      ':hover': sxVar.colorFillTertiary,
      'default': 'transparent',
    },
    borderRadius: 6,
    borderStyle: 'none',
    color: sxVar.colorTextSecondary,
    cursor: 'pointer',
    flexShrink: 0,
    fontSize: 14,
    fontWeight: 500,
    lineHeight: 1.5,
    maxWidth: 200,
    outline: { 'default': null, ':focus-visible': `2px solid ${sxVar.colorPrimary}` },
    outlineOffset: -1,
    overflow: 'hidden',
    paddingBlock: 2,
    paddingInline: 6,
    textOverflow: 'ellipsis',
    transitionDuration: '0.15s',
    transitionProperty: 'background-color',
    whiteSpace: 'nowrap',
  },
});

const TitleTags = memo(() => {
  const { t } = useTranslation(['topic', 'chat', 'thread']);
  const { threadId, topicId } = useAgentContext();
  const { backToTopic } = useThreadPlacement();
  const threadTitle = useChatStore((s) =>
    threadId && topicId
      ? s.threadMaps[topicId]?.find((thread) => thread.id === threadId)?.title
      : undefined,
  );
  const topicTitle = useChatStore((s) =>
    topicId ? topicSelectors.getTopicById(topicId)(s)?.title : undefined,
  );
  const isGroupSession = useSessionStore(sessionSelectors.isCurrentSessionGroupSession);

  // Archived topics fall out of the sidebar list fetch — pull their detail by
  // id so the title doesn't degrade to the "new topic" placeholder.
  useFetchActiveTopicDetail();

  if (isGroupSession) {
    return (
      <Flexbox allowShrink horizontal align={'center'} gap={12} style={{ minWidth: 0 }}>
        <MemberCountTag />
      </Flexbox>
    );
  }

  const fallbackTopicTitle = topicTitle || t('newTopic');
  const fallbackThreadTitle = threadTitle || t('thread.title', { ns: 'chat' });

  return (
    <Flexbox allowShrink horizontal align={'center'} gap={6} style={{ marginLeft: 8, minWidth: 0 }}>
      {threadId ? (
        <>
          <button
            title={t('portal.backToTopic', { ns: 'thread' })}
            type={'button'}
            {...stylex.props(styles.topicLink)}
            onClick={() => backToTopic(threadId)}
          >
            {fallbackTopicTitle}
          </button>
          <span
            style={{
              color: cssVar.colorTextQuaternary,
              flexShrink: 0,
              fontSize: 14,
            }}
          >
            {'/'}
          </span>
          <ThreadSwitcher title={fallbackThreadTitle} />
        </>
      ) : (
        <span
          style={{
            color: cssVar.colorText,
            fontSize: 14,
            fontWeight: 600,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {fallbackTopicTitle}
        </span>
      )}
    </Flexbox>
  );
});

export default TitleTags;

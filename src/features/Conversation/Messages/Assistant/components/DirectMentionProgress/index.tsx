'use client';

import { formatDuration } from '@lobechat/utils';
import { Block, Button, Flexbox, Tag, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { SquareArrowOutUpRightIcon } from 'lucide-react';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';

import { contextSelectors, useConversationStore } from '../../../../store';
import { summarizeThreadProgress } from './summarize';
import { selectThreadTranscript } from './threadTranscript';

const styles = stylex.create({
  activity: {
    color: cssVar.colorTextTertiary,
    fontSize: 13,
  },
  text: {
    color: cssVar.colorText,
  },
});

const useElapsed = (startedAt: number) => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  return Math.max(0, now - startedAt);
};

/** Header addon next to the agent's name: it is running, and for how long. */
export const DirectMentionStatus = memo<{ startedAt: number }>(({ startedAt }) => {
  const { t } = useTranslation('chat');
  const elapsed = useElapsed(startedAt);

  return (
    <Flexbox horizontal align={'center'} gap={6} style={{ whiteSpace: 'nowrap' }}>
      <Text type={'secondary'}>· {t('directMention.progress.running')}</Text>
      <Tag size={'small'}>
        {t('directMention.progress.elapsed', {
          time: formatDuration(Math.floor(elapsed / 1000) * 1000),
        })}
      </Tag>
    </Flexbox>
  );
});

DirectMentionStatus.displayName = 'DirectMentionStatus';

interface DirectMentionProgressProps {
  /** The mentioned agent, which runs the thread. */
  agentId: string;
  messageId: string;
  threadId: string;
}

/**
 * Live body for a direct @Agent reply still being written in its thread: what
 * the agent is doing and the newest line of its answer, with the way into the
 * full record.
 */
const DirectMentionProgress = memo<DirectMentionProgressProps>(
  ({ agentId, messageId, threadId }) => {
    const { t } = useTranslation('chat');
    const topicId = useConversationStore(contextSelectors.topicId);
    const openThreadInPortal = useChatStore((s) => s.openThreadInPortal);

    const messages = useChatStore(selectThreadTranscript({ agentId, threadId, topicId }));
    const { activity, text } = useMemo(
      () => summarizeThreadProgress(messages ?? [], threadId),
      [messages, threadId],
    );

    const activityLine =
      activity?.type === 'tool'
        ? t('directMention.progress.usingTool', { name: activity.name })
        : (activity?.text ?? t('directMention.progress.thinking'));

    return (
      <Flexbox gap={8}>
        <Block gap={8} paddingBlock={12} paddingInline={16} variant={'filled'}>
          <Text ellipsis {...stylex.props(styles.activity)}>
            {activityLine}
          </Text>
          {text && (
            <Text ellipsis {...stylex.props(styles.text)}>
              {text}
            </Text>
          )}
        </Block>
        <Flexbox horizontal>
          <Button
            icon={SquareArrowOutUpRightIcon}
            outdent={'start'}
            size={'small'}
            type={'text'}
            onClick={() => openThreadInPortal(threadId, messageId)}
          >
            {t('directMention.progress.viewFullRecord')}
          </Button>
        </Flexbox>
      </Flexbox>
    );
  },
);

DirectMentionProgress.displayName = 'DirectMentionProgress';

export default DirectMentionProgress;

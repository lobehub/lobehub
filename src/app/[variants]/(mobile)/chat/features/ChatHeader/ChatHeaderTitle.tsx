import { ActionIcon, Flexbox } from '@lobehub/ui';
import { ChatHeader } from '@lobehub/ui/mobile';
import { cssVar } from 'antd-style';
import { ChevronDown } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentStore } from '@/store/agent';
import { agentSelectors, builtinAgentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { useGlobalStore } from '@/store/global';

const ChatHeaderTitle = memo(() => {
  const { t } = useTranslation(['chat', 'topic']);
  const toggleConfig = useGlobalStore((s) => s.toggleMobileTopic);
  const [topicCount, topic] = useChatStore((s) => [
    topicSelectors.currentTopicCount(s),
    topicSelectors.currentActiveTopic(s),
  ]);
  const isInbox = useAgentStore(builtinAgentSelectors.isInboxAgent);
  const title = useAgentStore(agentSelectors.currentAgentTitle);

  const displayTitle = isInbox ? 'Lobe AI' : title;

  return (
    <ChatHeader.Title
      desc={
        <Flexbox horizontal align={'center'} gap={4} onClick={() => toggleConfig()}>
          <span
            style={{
              maxWidth: '60vw',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {topic?.title || t('title', { ns: 'topic' })}
          </span>
          <ActionIcon
            active
            icon={ChevronDown}
            size={{ blockSize: 14, borderRadius: '50%', size: 12 }}
            style={{
              background: cssVar.colorFillSecondary,
              color: cssVar.colorTextDescription,
            }}
          />
        </Flexbox>
      }
      title={
        <div
          style={{
            marginRight: '8px',
            maxWidth: '64vw',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          onClick={() => toggleConfig()}
        >
          {displayTitle}
          {topicCount > 0 ? ` (${topicCount})` : ''}
        </div>
      }
    />
  );
});

export default ChatHeaderTitle;

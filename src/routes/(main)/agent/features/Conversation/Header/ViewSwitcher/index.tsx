'use client';

import { Flexbox } from '@lobehub/ui';
import { Tabs } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { FileText, MessageSquareText } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useParams } from 'react-router';

import { SESSION_CHAT_TOPIC_PAGE_URL, SESSION_CHAT_TOPIC_URL } from '@/const/url';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';

type ViewTab = 'chat' | 'page' | 'task';

const styles = createStaticStyles(({ css }) => ({
  label: css`
    justify-content: center;
    width: 100%;
    min-width: 0;
  `,
  icon: css`
    display: none;

    @container agent-conv-header (max-width: 860px) {
      display: block;
    }
  `,
  text: css`
    display: block;
    text-align: center;
    white-space: nowrap;

    @container agent-conv-header (max-width: 860px) {
      display: none;
    }
  `,
}));

const ViewSwitcher = memo(() => {
  const { t } = useTranslation('chat');
  const navigate = useWorkspaceAwareNavigate();
  const location = useLocation();
  const params = useParams<{ aid?: string; topicId?: string }>();
  const activeTopicId = useChatStore((s) => s.activeTopicId);
  const isHeterogeneousAgent = useAgentStore(agentSelectors.isCurrentAgentHeterogeneous);

  const aid = params.aid;
  const topicId = params.topicId ?? activeTopicId ?? undefined;

  const currentTab = useMemo((): ViewTab => {
    if (!aid || !topicId) return 'chat';
    if (location.pathname.startsWith(SESSION_CHAT_TOPIC_PAGE_URL(aid, topicId))) return 'page';
    return 'chat';
  }, [aid, topicId, location.pathname]);

  const options = useMemo(
    () => [
      {
        key: 'chat',
        label: (
          <Flexbox
            horizontal
            align={'center'}
            className={styles.label}
            title={t('viewSwitcher.chat')}
          >
            <MessageSquareText className={styles.icon} size={16} />
            <span className={styles.text}>{t('viewSwitcher.chat')}</span>
          </Flexbox>
        ),
      },
      {
        key: 'page',
        label: (
          <Flexbox
            horizontal
            align={'center'}
            className={styles.label}
            title={t('viewSwitcher.page')}
          >
            <FileText className={styles.icon} size={16} />
            <span className={styles.text}>{t('viewSwitcher.page')}</span>
          </Flexbox>
        ),
      },
    ],
    [t],
  );

  const handleChange = (key: string) => {
    if (!aid) return;

    switch (key as ViewTab) {
      case 'chat': {
        if (topicId) navigate(SESSION_CHAT_TOPIC_URL(aid, topicId));
        break;
      }
      case 'page': {
        if (topicId) navigate(SESSION_CHAT_TOPIC_PAGE_URL(aid, topicId));
        break;
      }
      case 'task': {
        navigate(`/agent/${aid}/channel`);
        break;
      }
    }
  };

  if (!topicId || isHeterogeneousAgent) return null;

  return <Tabs activeKey={currentTab} items={options} size={'small'} onChange={handleChange} />;
});

ViewSwitcher.displayName = 'ViewSwitcher';

export default ViewSwitcher;

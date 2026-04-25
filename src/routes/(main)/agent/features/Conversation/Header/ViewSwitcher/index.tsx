'use client';

import { Flexbox, Segmented } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { FileText, MessageSquareText } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

import { SESSION_CHAT_TOPIC_PAGE_URL, SESSION_CHAT_TOPIC_URL } from '@/const/url';
import { useChatStore } from '@/store/chat';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';

type ViewTab = 'chat' | 'page' | 'task';

const styles = createStaticStyles(({ css }) => ({
  label: css`
    justify-content: center;
    width: 100%;
    min-width: 0;
  `,
  switcher: css`
    .ant-segmented-item-label {
      display: flex;
      align-items: center;
      justify-content: center;
    }
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
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams<{ aid?: string; topicId?: string }>();
  const activeTopicId = useChatStore((s) => s.activeTopicId);
  const enableAgentPage = useServerConfigStore((s) => featureFlagsSelectors(s).enableAgentPage);

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
        value: 'chat',
      },
      {
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
        value: 'page',
      },
      // { label: t('viewSwitcher.task'), value: 'task' },
    ],
    [t],
  );

  const handleChange = (value: number | string) => {
    if (!aid) return;

    switch (String(value) as ViewTab) {
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

  if (!topicId || !enableAgentPage) return null;

  return (
    <Segmented
      className={styles.switcher}
      options={options}
      size={'small'}
      value={currentTab}
      onChange={handleChange}
    />
  );
});

ViewSwitcher.displayName = 'ViewSwitcher';

export default ViewSwitcher;

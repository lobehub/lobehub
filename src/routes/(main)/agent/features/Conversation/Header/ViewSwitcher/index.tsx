'use client';

import { Segmented } from '@lobehub/ui';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

import { SESSION_CHAT_TOPIC_PAGE_URL, SESSION_CHAT_TOPIC_URL } from '@/const/url';
import { useChatStore } from '@/store/chat';

type ViewTab = 'chat' | 'page' | 'task';

const ViewSwitcher = memo(() => {
  const { t } = useTranslation('chat');
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams<{ aid?: string; topicId?: string }>();
  const activeTopicId = useChatStore((s) => s.activeTopicId);

  const aid = params.aid;
  const topicId = params.topicId ?? activeTopicId ?? undefined;

  const currentTab = useMemo((): ViewTab => {
    if (!aid || !topicId) return 'chat';
    if (location.pathname.startsWith(SESSION_CHAT_TOPIC_PAGE_URL(aid, topicId))) return 'page';
    return 'chat';
  }, [aid, topicId, location.pathname]);

  const options = useMemo(
    () => [
      { label: t('viewSwitcher.chat'), value: 'chat' },
      { label: t('viewSwitcher.page'), value: 'page' },
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

  if (!topicId) return null;

  return <Segmented options={options} size={'small'} value={currentTab} onChange={handleChange} />;
});

ViewSwitcher.displayName = 'ViewSwitcher';

export default ViewSwitcher;

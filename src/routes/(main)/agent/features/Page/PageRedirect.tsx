'use client';

import { memo, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import BrandTextLoading from '@/components/Loading/BrandTextLoading';
import { SESSION_CHAT_TOPIC_URL } from '@/const/url';
import { useAutoCreateTopicDocument } from '@/features/TopicCanvas/useAutoCreateTopicDocument';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';

const PageRedirect = memo(() => {
  const { aid, topicId } = useParams<{ aid?: string; topicId?: string }>();
  const navigate = useNavigate();
  const enableAgentPage = useServerConfigStore((s) => featureFlagsSelectors(s).enableAgentPage);
  const serverConfigInit = useServerConfigStore((s) => s.serverConfigInit);

  const { documentId } = useAutoCreateTopicDocument(
    enableAgentPage ? topicId : undefined,
    enableAgentPage ? aid : undefined,
  );

  useEffect(() => {
    if (!aid || !topicId || !serverConfigInit || enableAgentPage) return;

    navigate(SESSION_CHAT_TOPIC_URL(aid, topicId), { replace: true });
  }, [aid, topicId, serverConfigInit, enableAgentPage, navigate]);

  useEffect(() => {
    if (!aid || !topicId || !documentId || !enableAgentPage) return;
    navigate(`/agent/${aid}/${topicId}/page/${documentId}`, { replace: true });
  }, [aid, topicId, documentId, enableAgentPage, navigate]);

  return <BrandTextLoading debugId={'PageRedirect'} />;
});

PageRedirect.displayName = 'PageRedirect';

export default PageRedirect;

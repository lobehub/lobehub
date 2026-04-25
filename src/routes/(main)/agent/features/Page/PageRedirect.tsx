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
  const enableAgentTask = useServerConfigStore((s) => featureFlagsSelectors(s).enableAgentTask);
  const serverConfigInit = useServerConfigStore((s) => s.serverConfigInit);

  const { documentId } = useAutoCreateTopicDocument(
    enableAgentTask ? topicId : undefined,
    enableAgentTask ? aid : undefined,
  );

  useEffect(() => {
    if (!aid || !topicId || !serverConfigInit || enableAgentTask) return;

    navigate(SESSION_CHAT_TOPIC_URL(aid, topicId), { replace: true });
  }, [aid, topicId, serverConfigInit, enableAgentTask, navigate]);

  useEffect(() => {
    if (!aid || !topicId || !documentId || !enableAgentTask) return;
    navigate(`/agent/${aid}/${topicId}/page/${documentId}`, { replace: true });
  }, [aid, topicId, documentId, enableAgentTask, navigate]);

  return <BrandTextLoading debugId={'PageRedirect'} />;
});

PageRedirect.displayName = 'PageRedirect';

export default PageRedirect;

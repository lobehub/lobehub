'use client';

import { memo, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import BrandTextLoading from '@/components/Loading/BrandTextLoading';
import { useAutoCreateTopicDocument } from '@/features/TopicCanvas/useAutoCreateTopicDocument';

const PageRedirect = memo(() => {
  const { aid, topicId } = useParams<{ aid?: string; topicId?: string }>();
  const navigate = useNavigate();

  const { documentId } = useAutoCreateTopicDocument(topicId, aid);

  useEffect(() => {
    if (!aid || !topicId || !documentId) return;
    navigate(`/agent/${aid}/${topicId}/page/${documentId}`, { replace: true });
  }, [aid, topicId, documentId, navigate]);

  return <BrandTextLoading debugId={'PageRedirect'} />;
});

PageRedirect.displayName = 'PageRedirect';

export default PageRedirect;

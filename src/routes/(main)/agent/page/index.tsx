'use client';

import { memo } from 'react';
import { Navigate, useParams } from 'react-router-dom';

import { SESSION_CHAT_URL } from '@/const/url';

const PageRedirect = memo(() => {
  const params = useParams<{ aid?: string }>();

  return <Navigate replace to={params.aid ? SESSION_CHAT_URL(params.aid) : '/agent'} />;
});

export default PageRedirect;

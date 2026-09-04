'use client';

import { memo } from 'react';
import { Navigate } from 'react-router';
import urlJoin from 'url-join';

import { useParams } from '@/libs/router/navigation';

const LegacyRouteRedirect = memo(() => {
  const { aid, '*': rest } = useParams<{ '*': string; 'aid': string }>('aid', '*');

  if (!aid) return <Navigate replace to={'/'} />;

  return <Navigate replace to={urlJoin('/agent', aid, 'self-evolving', rest || '')} />;
});

LegacyRouteRedirect.displayName = 'LegacyRouteRedirect';

export default LegacyRouteRedirect;

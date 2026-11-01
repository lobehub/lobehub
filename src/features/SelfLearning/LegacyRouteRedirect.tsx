'use client';

import { memo } from 'react';
import { Navigate, useParams } from 'react-router';
import urlJoin from 'url-join';

const LegacyRouteRedirect = memo(() => {
  const { aid, '*': rest } = useParams<{ '*': string; 'aid': string }>();

  if (!aid) return <Navigate replace to={'/'} />;

  return <Navigate replace to={urlJoin('/agent', aid, 'self-evolving', rest || '')} />;
});

LegacyRouteRedirect.displayName = 'LegacyRouteRedirect';

export default LegacyRouteRedirect;

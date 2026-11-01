'use client';

import { memo, useLayoutEffect } from 'react';
import { useLocation, useParams } from 'react-router';

import { docsPagePath, RESOURCE_HOME_PATH } from '@/features/ResourceHome/paths';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { getIdFromIdentifier } from '@/utils/identifier';

/**
 * Pages live in Docs now: `/page` lands on the Docs home and `/page/:id` opens
 * the page inside Docs. Every existing link (recents, search, mentions, shares)
 * keeps working through this redirect; the query string is carried along.
 */
const PagesToDocsRedirect = memo(() => {
  const { id } = useParams<{ id?: string }>();
  const { search } = useLocation();
  const navigate = useWorkspaceAwareNavigate();

  useLayoutEffect(() => {
    const target = id ? docsPagePath(getIdFromIdentifier(id, 'docs')) : RESOURCE_HOME_PATH;
    navigate(`${target}${search}`, { replace: true });
  }, [id, navigate, search]);

  return null;
});

PagesToDocsRedirect.displayName = 'PagesToDocsRedirect';

export default PagesToDocsRedirect;

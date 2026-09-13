'use client';

import { taskTitleSlug } from '@lobechat/utils/taskSlug';
import { useEffect } from 'react';
import { useLocation } from 'react-router';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useActiveRouteParams } from '@/hooks/useActiveRouteParams';
import { useTaskStore } from '@/store/task';

import { taskDetailPath } from './taskDetailPath';

type CanonicalTaskSlugParams = {
  aid?: string;
  slug?: string;
  workspaceSlug?: string;
};

/**
 * Keep the readable tail of a task URL in sync with the task title.
 *
 * Upgrades a bare `/task/:taskId` link to `/task/:taskId/:slug` once the title
 * lands, and repairs a slug left stale by a rename or hand-edited by whoever
 * pasted the link. The slug is cosmetic — `taskId` remains the only resolution
 * key — so this never gates rendering or re-fetches, and `replace` keeps the
 * correction out of the back stack.
 *
 * Only route components may call this: the same detail body also renders inside
 * the chat Portal, which must not rewrite the address bar.
 */
export const useCanonicalTaskSlug = (taskId?: string) => {
  const { aid, slug, workspaceSlug } = useActiveRouteParams<CanonicalTaskSlugParams>();
  const { hash, search } = useLocation();
  const navigate = useWorkspaceAwareNavigate();
  // Loaded-ness and the title are read separately: an empty title is a real,
  // resolved state (clearing the input persists `name: ''`), and folding it in
  // with "not loaded yet" would pin the URL to the slug of the old title.
  const isLoaded = useTaskStore((s) => (taskId ? Boolean(s.taskDetailMap[taskId]) : false));
  const name = useTaskStore((s) => (taskId ? s.taskDetailMap[taskId]?.name : undefined));

  useEffect(() => {
    // Before the detail resolves the title is unknown — leaving the URL alone
    // beats stripping a slug the incoming link already carried. Once it has
    // resolved an empty title is honoured, collapsing the URL to `/task/:id`.
    if (!taskId || !isLoaded) return;

    const expected = taskTitleSlug(name);
    if ((slug ?? '') === expected) return;

    // Rebuild from the route params rather than the raw pathname so the
    // workspace prefix and agent scope of the current URL survive untouched;
    // `escape` then stops the workspace-aware navigate re-prefixing them.
    const prefix = workspaceSlug ? `/${workspaceSlug}` : '';
    navigate(`${prefix}${taskDetailPath(taskId, aid, name)}${search}${hash}`, {
      escape: true,
      replace: true,
    });
  }, [aid, hash, isLoaded, name, navigate, search, slug, taskId, workspaceSlug]);
};

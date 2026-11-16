import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';

import { useActiveLocation } from '@/hooks/useActiveLocation';
import { cacheScope } from '@/libs/replica';
import { channelActions } from '@/store/channel';

import { channelBasePath, matchChannelThread } from './paths';
import type { ChannelThreadDraft } from './threadDraft';

interface DraftSelection {
  channelId: string;
  pathname: string;
  scope: string;
  value: ChannelThreadDraft;
}

/** Opening/closing a preview is local; only its first send creates a persisted thread. */
export const useThreadPanel = (channelId: string) => {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useActiveLocation();
  // A thread link from the sidebar opens the thread as the page (`…/threads/:threadId`); one
  // opened from a message shows beside the Channel (`?thread=`).
  const pageThreadId = matchChannelThread(location.pathname) ?? null;
  const threadId = pageThreadId ? null : params.get('thread');
  const basePath = channelBasePath(location.pathname) ?? location.pathname;
  // Links shared before thread pages had their own path (`?thread=…&view=page`).
  const legacyPageThreadId =
    !pageThreadId && params.get('view') === 'page' ? params.get('thread') : null;
  const scope = cacheScope.use();
  const [selection, setSelection] = useState<DraftSelection | null>(null);
  const selected = useRef(selection);
  const selectionRevision = useRef(0);
  const renderedRevision = selectionRevision.current;
  const mounted = useRef(false);
  const latest = useRef({ basePath, channelId, pathname: location.pathname, setParams, threadId });
  latest.current = { basePath, channelId, pathname: location.pathname, setParams, threadId };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const setThread = (id: string | null, replace = false) =>
    latest.current.setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (id) next.set('thread', id);
        else next.delete('thread');
        return next;
      },
      { replace },
    );
  const clearDraft = () => {
    selectionRevision.current += 1;
    selected.current = null;
    setSelection(null);
  };
  const openThread = (id: string, toggle = true) => {
    // A completed main-feed send must not replace a newer local preview or its dismissal.
    if (!toggle && renderedRevision !== selectionRevision.current) return;
    clearDraft();
    setThread(toggle && threadId === id ? null : id);
  };
  const openDraft = (value: ChannelThreadDraft) => {
    selectionRevision.current += 1;
    const next = { channelId, pathname: location.pathname, scope, value };
    selected.current = next;
    setSelection(next);
    if (threadId) setThread(null, true);
  };
  const close = () => {
    clearDraft();
    if (pageThreadId) navigate(basePath);
    else if (threadId) setThread(null);
  };
  const openPage = (id: string) => {
    clearDraft();
    navigate(`${latest.current.basePath}/threads/${encodeURIComponent(id)}`);
  };
  const isCurrent = (draft: DraftSelection) =>
    mounted.current &&
    selected.current === draft &&
    cacheScope.get() === draft.scope &&
    latest.current.channelId === draft.channelId &&
    latest.current.pathname === draft.pathname &&
    !latest.current.threadId;

  const send = async (
    content: string,
    mentions: string[],
    requestKey: string,
    fileIds?: string[],
  ) => {
    const draft = selected.current;
    if (!draft || !isCurrent(draft)) throw new Error('Channel draft changed');
    const message = await channelActions.send({
      channelId: draft.channelId,
      content,
      fileIds,
      mentions,
      requestKey,
      rootMessageId: draft.value.root.id,
    });
    // A slow response must not reopen a closed preview or replace another conversation.
    if (isCurrent(draft) && message.threadId) {
      clearDraft();
      setThread(message.threadId, true);
    }
  };

  return {
    close,
    draft:
      !threadId &&
      selection?.channelId === channelId &&
      selection.scope === scope &&
      selection.pathname === location.pathname
        ? selection.value
        : null,
    openDraft,
    openPage,
    openThread,
    /** Where an old `?thread=…&view=page` link now lives; the page redirects there. */
    legacyPageUrl: legacyPageThreadId
      ? `${basePath}/threads/${encodeURIComponent(legacyPageThreadId)}`
      : null,
    /** The thread shown as the page; `threadId` is then null, as no panel is open. */
    pageThreadId,
    send,
    threadId,
  };
};

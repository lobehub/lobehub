import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';

import { useActiveLocation } from '@/hooks/useActiveLocation';
import { cacheScope } from '@/libs/replica';
import { channelActions } from '@/store/channel';

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
  const threadId = params.get('thread');
  const location = useActiveLocation();
  const scope = cacheScope.use();
  const [selection, setSelection] = useState<DraftSelection | null>(null);
  const selected = useRef(selection);
  const selectionRevision = useRef(0);
  const renderedRevision = selectionRevision.current;
  const mounted = useRef(false);
  const latest = useRef({ channelId, pathname: location.pathname, setParams, threadId });
  latest.current = { channelId, pathname: location.pathname, setParams, threadId };
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
    if (threadId) setThread(null);
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
    openThread,
    send,
    threadId,
  };
};

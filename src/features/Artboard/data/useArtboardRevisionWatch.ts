import type { ArtboardItem } from '@lobechat/types';
import { useEffect, useRef } from 'react';

import { useChatStore } from '@/store/chat';
import { AI_RUNTIME_OPERATION_TYPES } from '@/store/chat/slices/operation/types';

import { artboardActions, useArtboardStore } from '../store';
import { checkArtboardRevision } from './revisionWatch';

const runningInTopic = (topicId: string | null) => (s: ReturnType<typeof useChatStore.getState>) =>
  !!topicId &&
  Object.values(s.operations).some(
    (op) =>
      op.context.topicId === topicId &&
      op.status === 'running' &&
      AI_RUNTIME_OPERATION_TYPES.includes(op.type),
  );

export const useArtboardRevisionWatch = (
  artboard: Pick<ArtboardItem, 'id' | 'revision' | 'topicId'>,
) => {
  const { id, revision, topicId } = artboard;
  const running = useChatStore(runningInTopic(topicId));
  const stale = useArtboardStore((s) => s.staleRevision);
  const shown = useRef(revision);
  shown.current = revision;

  useEffect(() => {
    if (stale !== null && revision >= stale) artboardActions.setStaleRevision(null);
  }, [revision, stale]);

  useEffect(() => {
    const check = () => void checkArtboardRevision(id, shown.current).catch(() => {});
    window.addEventListener('focus', check);
    return () => window.removeEventListener('focus', check);
  }, [id]);

  const wasRunning = useRef(running);
  useEffect(() => {
    if (wasRunning.current && !running)
      void checkArtboardRevision(id, shown.current).catch(() => {});
    wasRunning.current = running;
  }, [id, running]);
};

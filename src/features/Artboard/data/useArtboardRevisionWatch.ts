import type { ArtboardItem } from '@lobechat/types';
import { useEffect, useRef } from 'react';

import { artboardActions, useArtboardStore } from '../store';
import { useAgentRunningInTopic } from './agentRunning';
import { checkArtboardRevision } from './revisionWatch';

/** While an agent runs, files land one by one (CLI writes); poll so boards fill in as they do. */
const RUNNING_POLL_INTERVAL = 2000;

export const useArtboardRevisionWatch = (
  artboard: Pick<ArtboardItem, 'id' | 'revision' | 'topicId' | 'updatedAt'>,
) => {
  const { id, revision, topicId, updatedAt } = artboard;
  const running = useAgentRunningInTopic(topicId);
  const stale = useArtboardStore((s) => s.staleRevision);
  const shown = useRef({ revision, updatedAt });
  shown.current = { revision, updatedAt };

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

  useEffect(() => {
    if (!running) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    // Chained, not an interval: a slow check never overlaps the next one.
    const schedule = () => {
      timer = setTimeout(async () => {
        await checkArtboardRevision(id, shown.current).catch(() => {});
        if (!stopped) schedule();
      }, RUNNING_POLL_INTERVAL);
    };
    schedule();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [id, running]);
};

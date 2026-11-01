import { useEffect, useRef } from 'react';

const RETRY_INTERVAL_MS = 2000;
const MAX_RETRIES = 15;

/**
 * Refetch the project topic list until a just-created topic shows up in it.
 *
 * The route moves to the new topic as soon as the send adopts its optimistic
 * row, before the server has persisted it, so the first refetch can come back
 * without it — and the list only polls for in-flight rows it already holds.
 * Retrying while the topic is unlisted closes that gap; a send that fails drops
 * the optimistic row, which ends the loop as well. Bounded so a topic that never
 * lands in this project cannot refetch forever.
 */
export const useRevalidateWhileUnlisted = (
  unlisted: boolean,
  topicId: string | undefined,
  revalidate: () => unknown,
) => {
  const revalidateRef = useRef(revalidate);
  revalidateRef.current = revalidate;

  useEffect(() => {
    if (!unlisted) return;
    void revalidateRef.current();
    let retries = 0;
    const timer = setInterval(() => {
      retries += 1;
      if (retries > MAX_RETRIES) return clearInterval(timer);
      void revalidateRef.current();
    }, RETRY_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [unlisted, topicId]);
};

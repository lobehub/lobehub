import type { RefObject } from 'react';
import { useEffect, useState } from 'react';

import type { TopicPreview } from '@/services/message/topicPreview';

import { waitForAnswerInView } from './waitForAnswerInView';

interface UsePreviewHandoffOptions {
  contextKey: string;
  listMounted: boolean;
  listRef: RefObject<HTMLElement | null>;
  preview?: TopicPreview;
}

// The list mounts at the top and lands on its bottom a few frames later, so the
// preview stays over it until the real final answer is where the preview drew it.
export const usePreviewHandoff = ({
  contextKey,
  listMounted,
  listRef,
  preview,
}: UsePreviewHandoffOptions) => {
  const [held, setHeld] = useState<{ contextKey: string; preview: TopicPreview }>();
  if (preview && (held?.preview !== preview || held.contextKey !== contextKey)) {
    setHeld({ contextKey, preview });
  } else if (!preview && held && held.contextKey !== contextKey) {
    setHeld(undefined);
  }

  const active = listMounted && held?.contextKey === contextKey ? held.preview : undefined;
  const messageId = active?.message.id;

  useEffect(() => {
    const container = listRef.current;
    if (!messageId || !container) return;
    return waitForAnswerInView({ container, messageId, onReady: () => setHeld(undefined) });
  }, [listRef, messageId]);

  return active;
};

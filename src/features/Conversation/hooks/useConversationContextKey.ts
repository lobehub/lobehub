import { useMemo } from 'react';

import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import { useConversationStore } from '../store';

/**
 * The key this conversation's composer state is filed under — pending uploads
 * and context selections alike.
 *
 * Every host that can put a file into a composer must derive the key from the
 * SAME context the composer reads, or the upload lands in a bucket nothing
 * renders. Deriving it here (rather than re-assembling `messageMapKey` at each
 * call site) is what keeps a drop zone, the editor's paste handler, and the
 * send path pointed at one bucket.
 */
export const useConversationContextKey = (): string => {
  const context = useConversationStore((s) => s.context);

  return useMemo(() => messageMapKey(context), [context]);
};

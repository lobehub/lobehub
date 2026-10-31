import type { ChannelPublicMessage } from '@lobechat/types';
import { useRef, useState } from 'react';
import { z } from 'zod';

import {
  getDraftEntry,
  removeDraftIfUnchanged,
  saveDraft,
} from '@/features/ChatInput/draftStorage';
import { cacheScope } from '@/libs/replica';

const targetSchema = z.object({
  author: z.object({
    avatar: z.string().nullable(),
    id: z.string().nullable(),
    name: z.string().nullable(),
    type: z.enum(['agent', 'user']),
  }),
  content: z.string(),
  id: z.string(),
  sequence: z.number(),
  threadId: z.string().nullable(),
});

export type ChannelReplyTarget = NonNullable<ChannelPublicMessage['replyTo']>;

/** Reply selection is a conversation-scoped draft, independent of the editor's document. */
export const useReplyTarget = (draftKey: string) => {
  const key = `${cacheScope.use()}:${draftKey}:reply`;
  const [selection, setSelection] = useState(() => {
    const entry = getDraftEntry(key);
    const parsed = targetSchema.safeParse(entry?.json);
    return { key, target: parsed.success ? parsed.data : null, revision: entry?.updatedAt };
  });
  const current = useRef(selection);
  current.current = selection;
  const select = (message: ChannelPublicMessage) => {
    const target: ChannelReplyTarget = {
      author: message.author,
      content: message.content.slice(0, 240),
      id: message.id,
      sequence: message.sequence,
      threadId: message.threadId,
    };
    const next = { key, target, revision: saveDraft(key, target) };
    current.current = next;
    setSelection(next);
  };
  const clear = (sent = current.current) => {
    removeDraftIfUnchanged(sent.key, sent.revision);
    if (current.current !== sent) return;
    const next = { key, target: null, revision: undefined };
    current.current = next;
    setSelection(next);
  };
  return {
    clear,
    select,
    snapshot: () => current.current,
    target: selection.key === key ? selection.target : null,
  };
};

import type { AcceptanceCommentList, CreateAcceptanceCommentInput } from '@lobechat/types';
import { useCallback, useMemo } from 'react';

import { useClientDataSWR } from '@/libs/swr';
import { acceptanceCommentKeys } from '@/libs/swr/keys';
import { acceptanceCommentService } from '@/services/acceptanceComment';

import {
  groupCommentThreads,
  listParticipants,
  summarizeApprovals,
  toggleReaction,
} from './threads';

const EMPTY: AcceptanceCommentList = { canApprove: false, canComment: false, items: [] };

/**
 * The whole discussion of one acceptance, read once and shared by every
 * consumer on the page through the SWR key. Mutations revalidate the list;
 * the bundle itself never changes because of a comment.
 */
export const useAcceptanceComments = (acceptanceId: string | undefined) => {
  const swr = useClientDataSWR<AcceptanceCommentList>(
    acceptanceId ? acceptanceCommentKeys.list(acceptanceId) : null,
    () => acceptanceCommentService.list(acceptanceId!),
    { revalidateOnFocus: true },
  );
  const data = swr.data ?? EMPTY;
  const { mutate } = swr;

  const threads = useMemo(() => groupCommentThreads(data.items), [data.items]);
  const approvals = useMemo(() => summarizeApprovals(data.items), [data.items]);
  const participants = useMemo(() => listParticipants(data.items), [data.items]);

  const create = useCallback(
    async (input: Omit<CreateAcceptanceCommentInput, 'acceptanceId'>) => {
      if (!acceptanceId) return;
      await acceptanceCommentService.create({ ...input, acceptanceId });
      await mutate();
    },
    [acceptanceId, mutate],
  );
  const remove = useCallback(
    async (id: string) => {
      await acceptanceCommentService.delete(id);
      await mutate();
    },
    [mutate],
  );
  /**
   * Optimistic on purpose: a chip that waits for a round trip before it fills
   * in makes the click feel broken, and the write is a single idempotent row.
   */
  const react = useCallback(
    async (id: string, emoji: string, on: boolean) => {
      if (!acceptanceId) return;
      await mutate(
        async () => {
          await acceptanceCommentService.react(id, emoji, on);
          // Read back rather than trusting the guess: the count also moves when
          // someone else reacts, and the names behind it are only known here.
          return acceptanceCommentService.list(acceptanceId);
        },
        {
          optimisticData: (current) => toggleReaction(current ?? EMPTY, id, emoji, on),
          revalidate: false,
        },
      );
    },
    [acceptanceId, mutate],
  );
  const setResolved = useCallback(
    async (id: string, resolved: boolean) => {
      await acceptanceCommentService.setResolved(id, resolved);
      await mutate();
    },
    [mutate],
  );

  return {
    approvals,
    canApprove: data.canApprove,
    canComment: data.canComment,
    /**
     * A failed read is not a permission answer. Without this the page falls
     * back to `canComment: false` and tells the owner to sign in, which is
     * both wrong and unactionable.
     */
    error: swr.error as Error | undefined,
    create,
    isLoading: swr.isLoading,
    items: data.items,
    participants,
    react,
    remove,
    setResolved,
    threads,
  };
};

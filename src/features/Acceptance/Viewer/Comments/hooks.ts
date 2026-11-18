import type {
  AcceptanceAccessDecision,
  AcceptanceCommentList,
  CreateAcceptanceCommentInput,
} from '@lobechat/types';
import { useCallback, useMemo } from 'react';

import { acceptanceCommentService } from '@/services/acceptanceComment';
import { useVerifyStore } from '@/store/verify';

import {
  groupCommentThreads,
  listParticipants,
  summarizeApprovals,
  toggleReaction,
} from './threads';
import { useAcceptanceCommentList } from './useAcceptanceCommentList';

const EMPTY: AcceptanceCommentList = { canApprove: false, canComment: false, items: [] };

/**
 * The whole discussion of one acceptance, read once and shared by every
 * consumer on the page through the verify store's comment replica. Mutations
 * re-read the discussion; the bundle itself never changes because of a comment.
 */
export const useAcceptanceComments = (acceptanceId: string | undefined) => {
  const list = useAcceptanceCommentList(acceptanceId);
  const data = list.data ?? EMPTY;
  const mutate = useCallback(async () => {
    if (acceptanceId) await useVerifyStore.getState().refreshAcceptanceComments(acceptanceId);
  }, [acceptanceId]);

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
  const requestAccess = useCallback(
    async (input: { clientId: string; content?: string; contextRunId?: string }) => {
      if (!acceptanceId) return;
      await acceptanceCommentService.requestAccess({ ...input, acceptanceId });
      await mutate();
    },
    [acceptanceId, mutate],
  );
  const answerAccessRequest = useCallback(
    async (id: string, decision: AcceptanceAccessDecision) => {
      await acceptanceCommentService.answerAccessRequest(id, decision);
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
      // Read back rather than trusting the guess: the count also moves when
      // someone else reacts, and the names behind it are only known here.
      await useVerifyStore.getState().optimisticAcceptanceComments(
        acceptanceId,
        (current) => toggleReaction(current, id, emoji, on),
        () => acceptanceCommentService.react(id, emoji, on),
      );
    },
    [acceptanceId],
  );
  const setResolved = useCallback(
    async (id: string, resolved: boolean) => {
      await acceptanceCommentService.setResolved(id, resolved);
      await mutate();
    },
    [mutate],
  );

  return {
    answerAccessRequest,
    approvals,
    canApprove: data.canApprove,
    canComment: data.canComment,
    canManageAccess: Boolean(data.canManageAccess),
    /**
     * A failed read is not a permission answer. Without this the page falls
     * back to `canComment: false` and tells the owner to sign in, which is
     * both wrong and unactionable.
     */
    error: list.error as Error | undefined,
    create,
    isLoading: list.isLoading,
    items: data.items,
    participants,
    react,
    remove,
    requestAccess,
    setResolved,
    threads,
  };
};

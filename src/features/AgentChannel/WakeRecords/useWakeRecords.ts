import type { BotWakeUserLabel, SignalDecisionOutcome } from '@lobechat/types';
import { useCallback } from 'react';
import useSWRInfinite from 'swr/infinite';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { mutate, useClientDataSWR } from '@/libs/swr';
import { botWakeKeys } from '@/libs/swr/keys';
import {
  agentBotProviderService,
  type WakeDecisionItem,
  type WakeDecisionPage,
} from '@/services/agentBotProvider';

export const WAKE_RECORDS_PAGE_SIZE = 20;

export interface WakeRecordFilters {
  followupOnly: boolean;
  outcome?: SignalDecisionOutcome;
  unmarkedOnly: boolean;
}

type DecisionsKey = ReturnType<typeof botWakeKeys.decisions>;

/** The page list with `decisionId`'s mark replaced; `undefined` pages stay as they are. */
export const withUserLabel = (
  pages: WakeDecisionPage[] | undefined,
  decisionId: string,
  userLabel: WakeDecisionItem['userLabel'],
): WakeDecisionPage[] | undefined =>
  pages?.map((page) => ({
    ...page,
    items: page.items.map((item) => (item.id === decisionId ? { ...item, userLabel } : item)),
  }));

/** Last-30-days counts for one bot. */
export const useWakeSummary = (botId: string) =>
  useClientDataSWR(botWakeKeys.summary(botId), () => agentBotProviderService.getWakeSummary(botId));

/**
 * One bot's decisions, a page at a time. Pages live in this hook's own SWR cache, which a global
 * key-filter `mutate` cannot reach (SWR skips `$inf$` keys), so marks go through `markDecision`.
 */
export const useWakeDecisions = (botId: string, filters: WakeRecordFilters) => {
  const workspaceId = useActiveWorkspaceId();
  const { followupOnly, outcome, unmarkedOnly } = filters;

  const getKey = useCallback(
    (_index: number, previous: WakeDecisionPage | null): DecisionsKey | null => {
      if (previous && !previous.nextCursor) return null;

      return botWakeKeys.decisions(
        workspaceId,
        botId,
        { followupOnly, outcome, unmarkedOnly },
        previous?.nextCursor,
      );
    },
    [botId, followupOnly, outcome, unmarkedOnly, workspaceId],
  );

  const swr = useSWRInfinite(
    getKey,
    ([, , id, keyOutcome, keyFollowup, keyUnmarked, cursorAt, cursorId]) =>
      agentBotProviderService.listWakeDecisions({
        botId: id as string,
        cursor: cursorAt ? { createdAt: cursorAt as string, id: cursorId as string } : undefined,
        followupOnly: (keyFollowup as boolean) || undefined,
        limit: WAKE_RECORDS_PAGE_SIZE,
        outcome: (keyOutcome as SignalDecisionOutcome | null) ?? undefined,
        unmarkedOnly: (keyUnmarked as boolean) || undefined,
      }),
    { revalidateFirstPage: false, revalidateOnFocus: false },
  );

  const { data: pages, mutate: mutatePages } = swr;

  /**
   * Shows the mark at once and saves it; a failed save puts the previous mark back and rethrows,
   * so the caller can say so. The summary refreshes after a save.
   */
  const markDecision = useCallback(
    async (decisionId: string, label: BotWakeUserLabel) => {
      const previous = pages
        ?.flatMap((page) => page.items)
        .find((item) => item.id === decisionId)?.userLabel;

      await mutatePages(
        (current) =>
          withUserLabel(current, decisionId, { createdAt: new Date(), label, note: undefined }),
        {
          revalidate: false,
        },
      );

      try {
        const saved = await agentBotProviderService.labelWakeDecision({ botId, decisionId, label });
        await mutatePages((current) => withUserLabel(current, decisionId, saved), {
          revalidate: false,
        });
      } catch (error) {
        await mutatePages((current) => withUserLabel(current, decisionId, previous ?? null), {
          revalidate: false,
        });
        throw error;
      }

      void mutate(botWakeKeys.summary(botId));
    },
    [botId, mutatePages, pages],
  );

  return { ...swr, markDecision };
};

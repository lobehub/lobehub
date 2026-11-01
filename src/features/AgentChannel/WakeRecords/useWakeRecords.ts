import type {
  BotWakeDecisionItem,
  BotWakeDecisionPage,
  BotWakeUserLabel,
  SignalDecisionOutcome,
} from '@lobechat/types';
import { useCallback } from 'react';

import { mutate, useClientDataSWR } from '@/libs/swr';
import { botWakeKeys } from '@/libs/swr/keys';
import { agentBotProviderService } from '@/services/agentBotProvider';

export const WAKE_RECORDS_PAGE_SIZE = 20;

export interface WakeRecordFilters {
  followupOnly: boolean;
  outcome?: SignalDecisionOutcome;
  unmarkedOnly: boolean;
}

/** The page with `decisionId`'s mark replaced; an unloaded page stays as it is. */
export const withUserLabel = (
  page: BotWakeDecisionPage | undefined,
  decisionId: string,
  userLabel: BotWakeDecisionItem['userLabel'],
): BotWakeDecisionPage | undefined =>
  page && {
    ...page,
    items: page.items.map((item) => (item.id === decisionId ? { ...item, userLabel } : item)),
  };

/**
 * The page asked for failed while another one is still on screen. `keepPreviousData` keeps the
 * old rows in `data`, so without this the failure would pass for the new page's rows.
 */
export const pageLoadFailed = ({
  data,
  error,
  isLoading,
}: {
  data: unknown;
  error: unknown;
  isLoading: boolean;
}): boolean => data !== undefined && !!error && !isLoading;

/**
 * Nothing matches, and that is the answer, not a failure: an empty page kept on screen by
 * `keepPreviousData` while the next filter's request failed is an error to show, not "no records".
 */
export const recordsEmpty = ({ error, total }: { error: unknown; total: number }): boolean =>
  total === 0 && !error;

/** Last-30-days counts for one bot. */
export const useWakeSummary = (botId: string) =>
  useClientDataSWR(botWakeKeys.summary(botId), () => agentBotProviderService.getWakeSummary(botId));

/**
 * One numbered page (1-based) of a bot's decisions, with the filtered total. The previous page stays
 * on screen while the next one loads, so the table does not collapse on every page turn.
 */
export const useWakeDecisions = (botId: string, filters: WakeRecordFilters, page: number) => {
  const { followupOnly, outcome, unmarkedOnly } = filters;

  const swr = useClientDataSWR<BotWakeDecisionPage>(
    botWakeKeys.decisions(botId, { followupOnly, outcome, unmarkedOnly }, page),
    () =>
      agentBotProviderService.listWakeDecisions({
        botId,
        followupOnly: followupOnly || undefined,
        limit: WAKE_RECORDS_PAGE_SIZE,
        offset: (page - 1) * WAKE_RECORDS_PAGE_SIZE,
        outcome,
        unmarkedOnly: unmarkedOnly || undefined,
      }),
    { keepPreviousData: true, revalidateOnFocus: false },
  );

  const { data, mutate: mutatePage } = swr;

  /**
   * Shows the mark at once and saves it; `null` takes the mark back. A failed save puts the
   * previous mark back and rethrows, so the caller can say so. The summary refreshes after a save.
   */
  const markDecision = useCallback(
    async (decisionId: string, label: BotWakeUserLabel | null) => {
      const previous = data?.items.find((item) => item.id === decisionId)?.userLabel;

      await mutatePage(
        (current) =>
          withUserLabel(
            current,
            decisionId,
            label ? { createdAt: new Date(), label, note: undefined } : null,
          ),
        { revalidate: false },
      );

      try {
        const saved = await agentBotProviderService.labelWakeDecision({ botId, decisionId, label });
        await mutatePage((current) => withUserLabel(current, decisionId, saved), {
          revalidate: false,
        });
      } catch (error) {
        await mutatePage((current) => withUserLabel(current, decisionId, previous ?? null), {
          revalidate: false,
        });
        throw error;
      }

      void mutate(botWakeKeys.summary(botId));
    },
    [botId, data, mutatePage],
  );

  return { ...swr, markDecision };
};

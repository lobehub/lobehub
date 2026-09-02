import useSWR from 'swr';

import { shareKeys } from '@/libs/swr/keys';
import { agentShareService } from '@/services/agentShare';

/**
 * Loads the share usage roll-up and resolves which spend cap to display.
 *
 * @param monthlySpendLimit The cap as currently configured in `LimitsSection`,
 *   from the share-status cache the owner's edits write to. The stats payload
 *   carries its own copy, but that lives under a different SWR key that no
 *   edit invalidates, so the label and bar would keep the OLD cap until a
 *   reload without it.
 */
export const useShareUsage = (agentId: string, monthlySpendLimit?: number) => {
  const { data, error, isLoading, isValidating, mutate } = useSWR(
    shareKeys.agentShareStats(agentId),
    () => agentShareService.getShareStats(agentId),
    { revalidateOnFocus: false },
  );

  return {
    data,
    error,
    // A failed roll-up must not read as "no traffic, nothing spent": zeros
    // there are a money claim, so the failure has to stay visible.
    hasLoadError: !!error && !data,
    isLoading: isLoading && !data,
    isValidating,
    // Every share carries a cap, so this is only ever absent while the stats
    // request is still in flight.
    limit: monthlySpendLimit ?? data?.monthlySpendLimit,
    mutate,
    // `null` means this deployment does not meter share spend.
    spend: data?.monthlySpend ?? null,
  };
};

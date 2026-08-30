import useSWR from 'swr';

import { topicKeys } from '@/libs/swr/keys';
import { useChatStore } from '@/store/chat';
import { useChatTopicById } from '@/store/chat/slices/topic/projection';

/** Poll cadence once the run is due — the cron dispatcher ticks every ~10 min. */
const POLL_INTERVAL_MS = 30_000;
/** Start polling slightly before `runAt` so the first due tick isn't missed. */
const POLL_LEAD_MS = 60_000;

/**
 * Watch the open topic while it is parked as `scheduled` (rate-limit resume or
 * a deferred send) and pull the cron dispatch into the store when it happens.
 *
 * The dispatcher only writes to the DB — there is no push channel to a client
 * already sitting on the topic — so without this the stale rate-limit card,
 * the `scheduled` status and the missing stream all persist until an unrelated
 * SWR revalidation (blur→focus, reconnect) happens to refetch.
 *
 * Two triggers, one sync (`syncScheduledTopicRun`):
 * - on topic entry: an immediate check, catching a dispatch that happened
 *   while the topic wasn't open;
 * - around `runAt`: a 30s poll, armed just before the run is due. Far from
 *   `runAt` the "interval" is a single timer that lands at the window start,
 *   so an idle parked topic costs no recurring requests.
 *
 * Stops by itself: once the sync folds the dispatch in, the topic's status
 * leaves `scheduled` and the SWR key becomes null. From there
 * `useGatewayReconnect` (keyed off the synced `runningOperation`) attaches to
 * the live stream.
 */
export const useScheduledRunWatch = (topicId: string | null | undefined) => {
  // `null` = scheduled but no runAt recorded — treat as due now rather than
  // never (mirrors the dispatcher, whose due query requires runAt <= now but
  // whose writers always stamp one).
  const topic = useChatTopicById(topicId ?? undefined);
  const scheduledRunAt: string | null | undefined =
    topic?.status === 'scheduled' ? (topic.metadata?.scheduledRun?.runAt ?? null) : undefined;

  useSWR(
    topicId && scheduledRunAt !== undefined ? topicKeys.scheduledRunWatch(topicId) : null,
    () => useChatStore.getState().syncScheduledTopicRun(topicId!),
    {
      refreshInterval: () => {
        if (scheduledRunAt === undefined) return 0;
        const dueAt = scheduledRunAt ? new Date(scheduledRunAt).getTime() - POLL_LEAD_MS : 0;
        const untilDue = dueAt - Date.now();
        return untilDue > POLL_INTERVAL_MS ? untilDue : POLL_INTERVAL_MS;
      },
      revalidateOnFocus: true,
      shouldRetryOnError: false,
    },
  );
};

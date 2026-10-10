import { useCallback, useEffect, useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';

import { messengerKeys } from '@/libs/swr/keys';
import { messengerService } from '@/services/messenger';

export const ONE_CLICK_BIND_POLL_INTERVAL_MS = 2000;

/**
 * Each mounted modal gets its own bind. A bind is one-shot (its code or OAuth
 * link is spent once it settles), so reopening the modal — e.g. "Add
 * workspace" after a Slack bind — must mint a new one rather than replay the
 * cached Connected / Expired result of the previous modal.
 */
let mountSeq = 0;

export type OneClickBindPlatform = 'discord' | 'slack' | 'telegram';

/**
 * Drives the unified `startBind` / `pollBind` pair: start a bind for
 * `platform` in the page locale, poll it until it leaves `pending` /
 * `scanned`, and refresh the detail page's link + install lists the moment it
 * lands. `retry` mints a fresh bind (new code / OAuth link, new poll).
 */
export const useOneClickBind = (platform: OneClickBindPlatform, locale: string) => {
  const { mutate } = useSWRConfig();
  const [mountId] = useState(() => ++mountSeq);
  const [attempt, setAttempt] = useState(0);

  const start = useSWR(
    messengerKeys.startBind(platform, mountId, attempt),
    () => messengerService.startBind({ locale, platform }),
    {
      revalidateIfStale: false,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      shouldRetryOnError: false,
    },
  );
  const pollId = start.data?.pollId;
  const poll = useSWR(
    pollId ? messengerKeys.pollBind(pollId) : null,
    () => messengerService.pollBind(pollId!),
    {
      refreshInterval: (latest) =>
        !latest || latest.status === 'pending' || latest.status === 'scanned'
          ? ONE_CLICK_BIND_POLL_INTERVAL_MS
          : 0,
      revalidateOnFocus: false,
    },
  );
  const status = poll.data?.status ?? 'pending';

  // The detail page behind the modal lists links and installs; refresh it the
  // moment the bind lands so closing the modal shows the new connection.
  useEffect(() => {
    if (status !== 'linked') return;
    void mutate(messengerKeys.listMyLinks());
    void mutate(messengerKeys.listMyInstallations());
  }, [mutate, status]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return {
    failedReason: poll.data?.status === 'failed' ? poll.data.reason : undefined,
    // Kept until a poll succeeds again — SWR clears `error` on the next good
    // response — so a flaky network does not strand the modal on its spinner.
    pollError: poll.error as unknown,
    retry,
    start: start.data,
    startError: start.error as unknown,
    status,
  };
};

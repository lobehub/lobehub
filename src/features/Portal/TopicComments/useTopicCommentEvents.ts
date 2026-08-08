'use client';

import { fetchEventSource } from '@lobechat/utils/client';
import { useEffect } from 'react';

const EVENT_DEBOUNCE_INTERVAL = 250;
const POLLING_INTERVAL = 30_000;
const POLLING_MAX_BACKOFF_EXPONENT = 4;
const POLLING_MAX_INTERVAL = 5 * 60_000;
const RECONNECT_BASE_INTERVAL = 5000;
const RECONNECT_MAX_INTERVAL = 60_000;

const buildHeaders = async (): Promise<Record<string, string>> => {
  const { createHeaderWithAuth } = await import('@/services/_auth');
  const headers = (await createHeaderWithAuth()) as Record<string, string>;
  const { getBusinessTrpcHeaders } = await import('@/business/client/trpc-headers');
  Object.assign(headers, await getBusinessTrpcHeaders());
  return headers;
};

export const useTopicCommentEvents = (
  topicId: string | undefined,
  refresh: () => void | Promise<void>,
) => {
  useEffect(() => {
    if (!topicId) return;

    const ac = new AbortController();
    let cancelled = false;
    let terminal = false;
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;
    let pollTimer: ReturnType<typeof setInterval> | undefined;
    let pendingWaitCleanup: (() => void) | undefined;
    let pollingFailureCount = 0;
    let reconnectAttempt = 0;
    let refreshing = false;
    let refreshQueued = false;

    const isVisible = () => document.visibilityState !== 'hidden';
    const stopPolling = () => {
      clearInterval(pollTimer);
      pollTimer = undefined;
    };
    const startPolling = () => {
      if (!pollTimer && !cancelled && !terminal && isVisible()) {
        const interval = Math.min(
          POLLING_MAX_INTERVAL,
          POLLING_INTERVAL * 2 ** pollingFailureCount,
        );
        pollTimer = setInterval(() => void runRefresh(), interval);
      }
    };
    const updatePollingBackoff = (failureCount: number) => {
      if (pollingFailureCount === failureCount) return;
      pollingFailureCount = failureCount;
      if (!pollTimer) return;
      stopPolling();
      startPolling();
    };
    async function runRefresh() {
      if (cancelled || terminal || !isVisible()) return;
      if (refreshing) {
        refreshQueued = true;
        return;
      }
      refreshing = true;
      try {
        await refresh();
        updatePollingBackoff(0);
      } catch {
        updatePollingBackoff(Math.min(pollingFailureCount + 1, POLLING_MAX_BACKOFF_EXPONENT));
      } finally {
        refreshing = false;
        if (refreshQueued && !cancelled) {
          refreshQueued = false;
          void runRefresh();
        }
      }
    }
    const scheduleRefresh = () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => void runRefresh(), EVENT_DEBOUNCE_INTERVAL);
    };
    const stopPendingWait = () => {
      const cleanup = pendingWaitCleanup;
      pendingWaitCleanup = undefined;
      cleanup?.();
    };
    const waitUntilVisible = () => {
      if (isVisible()) return Promise.resolve();

      return new Promise<void>((resolve) => {
        const finish = () => {
          document.removeEventListener('visibilitychange', handleVisibilityChange);
          if (pendingWaitCleanup === finish) pendingWaitCleanup = undefined;
          resolve();
        };
        const handleVisibilityChange = () => {
          if (isVisible()) finish();
        };
        pendingWaitCleanup = finish;
        document.addEventListener('visibilitychange', handleVisibilityChange);
      });
    };
    const waitBeforeReconnect = (attempt: number) =>
      new Promise<void>((resolve) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const delay = Math.min(
          RECONNECT_MAX_INTERVAL,
          Math.round(RECONNECT_BASE_INTERVAL * 2 ** attempt * (0.8 + Math.random() * 0.4)),
        );
        const finish = () => {
          clearTimeout(timer);
          document.removeEventListener('visibilitychange', handleVisibilityChange);
          if (pendingWaitCleanup === finish) pendingWaitCleanup = undefined;
          resolve();
        };
        const schedule = () => {
          if (!timer && isVisible()) timer = setTimeout(finish, delay);
        };
        const handleVisibilityChange = () => {
          if (isVisible()) {
            schedule();
          } else {
            clearTimeout(timer);
            timer = undefined;
          }
        };
        pendingWaitCleanup = finish;
        document.addEventListener('visibilitychange', handleVisibilityChange);
        schedule();
      });

    const handleVisibilityChange = () => {
      if (!isVisible()) {
        stopPolling();
        clearTimeout(debounceTimer);
        return;
      }
      if (terminal) return;
      startPolling();
      void runRefresh();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    startPolling();

    const start = async () => {
      while (!cancelled) {
        await waitUntilVisible();
        if (cancelled) return;

        let headers: Record<string, string>;
        try {
          headers = await buildHeaders();
        } catch {
          if (cancelled) return;
          startPolling();
          await waitBeforeReconnect(reconnectAttempt++);
          continue;
        }
        if (cancelled) return;

        await fetchEventSource(
          `/webapi/topic-comment/events?topicId=${encodeURIComponent(topicId)}`,
          {
            credentials: 'include',
            headers,
            onerror: (error: { fatal?: boolean }) => {
              if (cancelled) return;
              if (error?.fatal) {
                terminal = true;
                stopPolling();
                return;
              }
              startPolling();
            },
            onmessage: (event) => {
              if (!event.data) return;
              try {
                const parsed = JSON.parse(event.data) as { type?: string };
                if (parsed.type === 'topic.commentsChanged') scheduleRefresh();
              } catch {
                // Ignore malformed transport frames; canonical polling remains available.
              }
            },
            onopen: async (response) => {
              if (
                response.ok &&
                response.headers.get('content-type')?.includes('text/event-stream')
              ) {
                reconnectAttempt = 0;
                await runRefresh();
                return;
              }
              const error: Error & { fatal?: boolean } = new Error(
                `SSE failed: ${response.status}`,
              );
              error.fatal = [400, 401, 403, 404].includes(response.status);
              throw error;
            },
            signal: ac.signal,
          },
        );
        if (cancelled || terminal) return;

        // The shared fetchEventSource is intentionally one-shot. A normal server
        // close resolves without onerror, so reconnect explicitly and poll across the gap.
        startPolling();
        await waitBeforeReconnect(reconnectAttempt++);
      }
    };

    void start().catch(() => {
      if (!cancelled) startPolling();
    });
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      stopPendingWait();
      ac.abort();
      clearTimeout(debounceTimer);
      stopPolling();
    };
  }, [refresh, topicId]);
};

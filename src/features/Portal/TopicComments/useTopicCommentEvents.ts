'use client';

import { fetchEventSource } from '@lobechat/utils/client';
import { useEffect } from 'react';

const EVENT_DEBOUNCE_INTERVAL = 250;
const POLLING_INTERVAL = 30_000;
const RECONNECT_INTERVAL = 5000;

const buildHeaders = async (): Promise<Record<string, string>> => {
  const { createHeaderWithAuth } = await import('@/services/_auth');
  const headers = (await createHeaderWithAuth()) as Record<string, string>;
  const { getBusinessTrpcHeaders } = await import('@/business/client/trpc-headers');
  Object.assign(headers, await getBusinessTrpcHeaders());
  return headers;
};

export const useTopicCommentEvents = (
  topicId: string | undefined,
  enabled: boolean,
  refresh: () => void | Promise<void>,
) => {
  useEffect(() => {
    if (!enabled || !topicId) return;

    const ac = new AbortController();
    let cancelled = false;
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;
    let pollTimer: ReturnType<typeof setInterval> | undefined;
    let reconnectResolver: (() => void) | undefined;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let refreshing = false;
    let refreshQueued = false;

    const runRefresh = async () => {
      if (cancelled) return;
      if (refreshing) {
        refreshQueued = true;
        return;
      }
      refreshing = true;
      try {
        await refresh();
      } catch {
        // Realtime invalidation is best-effort; the next event or polling tick retries.
      } finally {
        refreshing = false;
        if (refreshQueued && !cancelled) {
          refreshQueued = false;
          void runRefresh();
        }
      }
    };
    const scheduleRefresh = () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => void runRefresh(), EVENT_DEBOUNCE_INTERVAL);
    };
    const stopPolling = () => {
      clearInterval(pollTimer);
      pollTimer = undefined;
    };
    const startPolling = () => {
      if (!pollTimer) pollTimer = setInterval(() => void runRefresh(), POLLING_INTERVAL);
    };
    const stopReconnectWait = () => {
      clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
      const resolve = reconnectResolver;
      reconnectResolver = undefined;
      resolve?.();
    };
    const waitBeforeReconnect = () =>
      new Promise<void>((resolve) => {
        reconnectResolver = resolve;
        reconnectTimer = setTimeout(() => {
          reconnectResolver = undefined;
          reconnectTimer = undefined;
          resolve();
        }, RECONNECT_INTERVAL);
      });

    const start = async () => {
      while (!cancelled) {
        let headers: Record<string, string>;
        try {
          headers = await buildHeaders();
        } catch {
          startPolling();
          await waitBeforeReconnect();
          continue;
        }
        if (cancelled) return;

        let fatal = false;
        await fetchEventSource(
          `/webapi/topic-comment/events?topicId=${encodeURIComponent(topicId)}`,
          {
            credentials: 'include',
            headers,
            onerror: (error: { fatal?: boolean }) => {
              if (cancelled) return;
              if (error?.fatal) {
                fatal = true;
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
                stopPolling();
                await runRefresh();
                return;
              }
              const error: Error & { fatal?: boolean } = new Error(
                `SSE failed: ${response.status}`,
              );
              error.fatal = response.status >= 400 && response.status < 500;
              throw error;
            },
            signal: ac.signal,
          },
        );
        if (cancelled || fatal) return;

        // The shared fetchEventSource is intentionally one-shot. A normal server
        // close resolves without onerror, so reconnect explicitly and poll across the gap.
        startPolling();
        await waitBeforeReconnect();
      }
    };

    void start().catch(() => {
      if (!cancelled) startPolling();
    });
    return () => {
      cancelled = true;
      stopReconnectWait();
      ac.abort();
      clearTimeout(debounceTimer);
      stopPolling();
    };
  }, [enabled, refresh, topicId]);
};

'use client';

import { fetchEventSource } from '@lobechat/utils/client';
import { useEffect } from 'react';

import { mutate } from '@/libs/swr';
import { documentService } from '@/services/document';
import { documentSWRKeys } from '@/services/document/swrKeys';
import { pageSelectors, usePageStore } from '@/store/page';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/slices/auth/selectors';

import { usePageEditorStore } from './store';

const buildHeaders = async (): Promise<Record<string, string>> => {
  // Mirror the tRPC lambda client so the SSE request carries the same auth +
  // workspace (X-Workspace-Id) context the server resolves against.
  const { createHeaderWithAuth } = await import('@/services/_auth');
  const headers = (await createHeaderWithAuth()) as Record<string, string>;
  const { getBusinessTrpcHeaders } = await import('@/business/client/trpc-headers');
  Object.assign(headers, await getBusinessTrpcHeaders());
  return headers;
};

/**
 * Subscribes the open workspace page to its realtime event stream so content
 * and lock state sync near-instantly instead of waiting for the polling
 * heartbeat. Mounted alongside {@link useDocumentLock}, but gated on the page
 * being a workspace page ONLY (not on holding the lock) — pure viewers must
 * receive updates too. Degrades silently to polling when the stream is
 * unavailable.
 */
export const useResourceEvents = () => {
  const documentId = usePageEditorStore((s) => s.documentId);
  const setLockState = usePageEditorStore((s) => s.setLockState);
  const lockOwnerId = usePageEditorStore((s) => s.lockOwnerId);
  const workspaceId = usePageStore(
    (s) => pageSelectors.getDocumentById(documentId)(s)?.workspaceId,
  );
  const myUserId = useUserStore(userProfileSelectors.userId);

  const enabled = Boolean(documentId && workspaceId);

  useEffect(() => {
    if (!enabled || !documentId) return;

    const ac = new AbortController();
    let cancelled = false;

    const start = async () => {
      const headers = await buildHeaders();
      if (cancelled) return;

      void fetchEventSource(
        `/webapi/document/events?documentId=${encodeURIComponent(documentId)}`,
        {
          credentials: 'include',
          headers,
          onerror: (err: { fatal?: boolean }) => {
            // 4xx (auth/not-found) won't recover; stop. Else reconnect in 5s —
            // the lock heartbeat keeps things synced across the gap.
            if (err?.fatal) throw err;
            return 5000;
          },
          onmessage: (ev) => {
            if (!ev.data) return;
            let parsed: {
              actorId?: string;
              data?: {
                expiresAt?: string | null;
                holderId?: string | null;
                ownerId?: string | null;
              };
              type?: string;
            };
            try {
              parsed = JSON.parse(ev.data);
            } catch {
              return;
            }
            // Ignore our own echoes.
            if (parsed.actorId && parsed.actorId === myUserId) return;

            if (parsed.type === 'doc.updated') {
              // Re-fetch; DocumentIdMode re-hydrates the editor on the new
              // version when the local editor isn't dirty.
              void mutate(documentSWRKeys.editor(documentId));
            } else if (parsed.type === 'lock.changed') {
              // Store the holder verbatim; "locked by other" is derived against
              // the current user/session at read time (usePageLockedByOther).
              setLockState(
                parsed.data?.holderId ?? null,
                parsed.data?.expiresAt ?? null,
                parsed.data?.ownerId ?? null,
              );
            }
          },
          onopen: async (res) => {
            if (res.ok && res.headers.get('content-type')?.includes('text/event-stream')) {
              // Force a fresh peek every time the SSE channel (re)opens. Events
              // dropped during the connect gap — including the holder's
              // `release` broadcast — would otherwise leave the viewer stuck on
              // a stale "X is editing this document" until lease expiry.
              documentService
                .getDocumentLock(documentId, lockOwnerId)
                .then((lock) => {
                  if (cancelled) return;
                  setLockState(lock.holderId, lock.expiresAt, lock.ownerId);
                })
                .catch(() => {
                  // Resync is best-effort; the regular lock heartbeat tick will
                  // retry naturally — no need to surface the error.
                });
              return;
            }
            const error: Error & { fatal?: boolean } = new Error(`SSE failed: ${res.status}`);
            error.fatal = res.status >= 400 && res.status < 500;
            throw error;
          },
          signal: ac.signal,
        },
      ).catch(() => {
        // Swallow — realtime is best-effort; the polling heartbeat is the fallback.
      });
    };

    void start();

    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [enabled, documentId, workspaceId, myUserId, setLockState, lockOwnerId]);
};

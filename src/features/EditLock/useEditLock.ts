'use client';

import { useEffect, useRef, useState } from 'react';

import { DOCUMENT_LOCK_HEARTBEAT_MS } from '@/const/documentLock';

export interface EditLockState {
  holderId: string | null;
  lockedByOther: boolean;
}

export interface EditLockResult extends EditLockState {
  /**
   * True while the lock is enabled but its state hasn't been resolved yet (the
   * first peek/acquire is still in flight). Callers should treat the editor as
   * read-only until this clears, so a user can't start typing on a resource that
   * turns out to be locked by someone else (and get bounced mid-edit).
   */
  pending: boolean;
}

/** Per-resource lock RPCs (bind these to the resource's trpc procedures). */
export interface EditLockClient {
  acquire: (id: string) => Promise<EditLockState>;
  peek: (id: string) => Promise<EditLockState>;
  release: (id: string) => Promise<void>;
}

interface UseEditLockOptions {
  client: EditLockClient;
  /** Whether the surface participates in locking (e.g. workspace-scoped + can edit). */
  enabled: boolean;
  /** First real edit; latches edit-intent so the lock is acquired implicitly. */
  isDirty: boolean;
  /**
   * Re-peek the lock on an interval while viewing (not editing) to notice another
   * member starting/stopping. Defaults to true. Set false for surfaces that get
   * realtime lock pushes (e.g. pages via SSE) and only need the single peek-on-open.
   */
  pollWhileViewing?: boolean;
  resourceId: string | undefined;
}

const UNLOCKED: EditLockState = { holderId: null, lockedByOther: false };

/**
 * Generic, self-contained collaborative edit lock for any editable resource.
 *
 * Mirrors the page lock without depending on a specific store: peek the lock on
 * open (so an already-edited resource is read-only up front), acquire it on the
 * first edit and heartbeat to hold it, release on unmount. Returns the lock
 * state for the caller to gate its editor (read-only) and render an indicator.
 *
 * `client` MUST be a stable reference (module-level / memoized) — it's an effect
 * dependency.
 */
export const useEditLock = ({
  client,
  enabled,
  isDirty,
  pollWhileViewing = true,
  resourceId,
}: UseEditLockOptions): EditLockResult => {
  const [state, setState] = useState<EditLockState>(UNLOCKED);
  const [editIntent, setEditIntent] = useState(false);
  // False until the first peek/acquire settles, so the editor stays read-only
  // until we actually know whether the resource is free.
  const [resolved, setResolved] = useState(false);

  // Reset synchronously when the resource changes (React "adjust state during
  // render"), so a new resource never inherits the previous one's lock/intent.
  const idRef = useRef(resourceId);
  if (idRef.current !== resourceId) {
    idRef.current = resourceId;
    setEditIntent(false);
    setState(UNLOCKED);
    setResolved(false);
  }

  useEffect(() => {
    if (enabled && isDirty) setEditIntent(true);
  }, [enabled, isDirty]);

  const active = Boolean(enabled && resourceId);
  const engaged = active && editIntent;

  // Viewer: poll the lock so an already-edited resource is read-only up front
  // and so we notice when someone else starts/stops editing.
  useEffect(() => {
    if (!active || !resourceId || editIntent) return;
    let cancelled = false;
    const tick = () => {
      client
        .peek(resourceId)
        .then((s) => {
          if (cancelled) return;
          setState(s);
          setResolved(true);
        })
        // Fail-open: a peek hiccup must not strand the editor read-only forever.
        .catch(() => {
          if (!cancelled) setResolved(true);
        });
    };
    tick();
    // Surfaces with a realtime push channel only need the single peek-on-open.
    const timer = pollWhileViewing ? setInterval(tick, DOCUMENT_LOCK_HEARTBEAT_MS) : undefined;
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [active, resourceId, editIntent, client, pollWhileViewing]);

  // Editor: acquire/refresh the lock while editing; release on unmount.
  useEffect(() => {
    if (!engaged || !resourceId) return;
    let cancelled = false;
    const tick = () => {
      client
        .acquire(resourceId)
        .then((s) => {
          if (cancelled) return;
          setState(s);
          setResolved(true);
        })
        .catch(() => {
          if (!cancelled) setResolved(true);
        });
    };
    tick();
    const timer = setInterval(tick, DOCUMENT_LOCK_HEARTBEAT_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
      setState(UNLOCKED);
      client.release(resourceId).catch(() => {});
    };
  }, [engaged, resourceId, client]);

  return { ...state, pending: active && !resolved };
};

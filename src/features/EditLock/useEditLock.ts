'use client';

import { useEffect, useRef, useState } from 'react';

import { DOCUMENT_LOCK_HEARTBEAT_MS } from '@/const/documentLock';

/**
 * Lock health from the holding editor's perspective:
 *
 * - `healthy`: the latest heartbeat confirmed we still hold the lock.
 * - `unstable`: one heartbeat just failed; we're retrying before declaring loss
 *   so a normal network blip doesn't flip the editor into a warning state.
 * - `lost`: repeated heartbeats failed or the server confirmed another holder.
 *   The lock loop keeps ticking from this state so we auto-reclaim once the
 *   network / contender clears.
 *
 * Viewers (editIntent=false) always report `healthy` — they have no lock to
 * lose; the `lockedByOther` flag carries the equivalent signal for them.
 */
export type EditLockHealth = 'healthy' | 'unstable' | 'lost';

export interface EditLockState {
  expiresAt?: Date | string | null;
  holderId: string | null;
  lockedByOther: boolean;
  ownerId?: string | null;
}

export interface EditLockResult extends EditLockState {
  /** See {@link EditLockHealth}. Always `healthy` for viewers. */
  health: EditLockHealth;
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
  acquire: (id: string, ownerId?: string) => Promise<EditLockState>;
  peek: (id: string, ownerId?: string) => Promise<EditLockState>;
  release: (id: string, ownerId?: string) => Promise<void>;
}

interface UseEditLockOptions {
  client: EditLockClient;
  /** Whether the surface participates in locking (e.g. workspace-scoped + can edit). */
  enabled: boolean;
  /** First real edit; latches edit-intent so the lock is acquired implicitly. */
  isDirty: boolean;
  ownerId?: string;
  /**
   * Re-peek the lock on an interval while viewing (not editing) to notice another
   * member starting/stopping. Defaults to true. Set false for surfaces that get
   * realtime lock pushes (e.g. pages via SSE) and only need the single peek-on-open.
   */
  pollWhileViewing?: boolean;
  resourceId: string | undefined;
}

const UNLOCKED: EditLockState = { holderId: null, lockedByOther: false };
const LOCK_REFRESH_SAFETY_MS = 8000;
/**
 * Backoff before re-acquiring after a single transient failure. Short enough
 * that one Redis hiccup never escalates to a visible "lost" banner.
 */
const LOCK_RETRY_BACKOFF_MS = 500;
/**
 * Slow safety-net peek interval when the caller has opted out of fast viewer
 * polling (i.e. surfaces with realtime SSE pushes). The SSE channel is still
 * the primary signal; this tick only exists to catch events lost during a
 * reconnect window or because the holder's `release` request was aborted by
 * navigation. Long enough not to add meaningful QPS, short enough that a
 * stranded viewer recovers in under a minute.
 */
const VIEWER_FALLBACK_POLL_MS = 60_000;

const nextRefreshDelay = (expiresAt: EditLockState['expiresAt']) => {
  if (!expiresAt) return DOCUMENT_LOCK_HEARTBEAT_MS;

  const expiresAtTime =
    expiresAt instanceof Date ? expiresAt.getTime() : new Date(expiresAt).getTime();
  if (Number.isNaN(expiresAtTime)) return DOCUMENT_LOCK_HEARTBEAT_MS;

  return Math.max(1000, expiresAtTime - Date.now() - LOCK_REFRESH_SAFETY_MS);
};

/**
 * Generic, self-contained collaborative edit lock for any editable resource.
 *
 * Mirrors the page lock without depending on a specific store: peek the lock on
 * open (so an already-edited resource is read-only up front), acquire it on the
 * first edit and heartbeat to hold it, release on unmount. Returns the lock
 * state for the caller to gate its editor (read-only) and render an indicator.
 *
 * Health-aware heartbeat: a single failed acquire is treated as transient and
 * retried after a short backoff before the caller sees `health = 'unstable'`.
 * Repeated failures (or the server confirming another holder) flip to `lost`,
 * but the loop keeps ticking — when the network or contender clears we
 * auto-reclaim the lock without any caller action. We also kick a fresh
 * heartbeat when the browser comes back online or refocuses, so a returning
 * user doesn't sit in `unstable`/`lost` until the next scheduled tick.
 *
 * `client` MUST be a stable reference (module-level / memoized) — it's an effect
 * dependency.
 */
export const useEditLock = ({
  client,
  enabled,
  isDirty,
  ownerId,
  pollWhileViewing = true,
  resourceId,
}: UseEditLockOptions): EditLockResult => {
  const [state, setState] = useState<EditLockState>(UNLOCKED);
  const [editIntent, setEditIntent] = useState(false);
  // False until the first peek/acquire settles, so the editor stays read-only
  // until we actually know whether the resource is free.
  const [resolved, setResolved] = useState(false);
  const [health, setHealth] = useState<EditLockHealth>('healthy');

  // Reset synchronously when the resource changes (React "adjust state during
  // render"), so a new resource never inherits the previous one's lock/intent.
  const idRef = useRef(resourceId);
  if (idRef.current !== resourceId) {
    idRef.current = resourceId;
    setEditIntent(false);
    setState(UNLOCKED);
    setResolved(false);
    setHealth('healthy');
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
        .peek(resourceId, ownerId)
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
    // Surfaces with a realtime push channel still need a low-frequency safety
    // net: SSE may drop events on reconnect, and the holder's release request
    // can be aborted by navigation — without this poll, a viewer could be
    // stranded on a stale holder until the lease expires (up to 30 s).
    const interval = pollWhileViewing ? DOCUMENT_LOCK_HEARTBEAT_MS : VIEWER_FALLBACK_POLL_MS;
    const timer = setInterval(tick, interval);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [active, resourceId, editIntent, client, ownerId, pollWhileViewing]);

  // Editor: acquire/refresh the lock while editing; track health; auto-reclaim
  // after loss; release on unmount.
  useEffect(() => {
    if (!engaged || !resourceId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Failure streak across ticks within this engaged window. A single hiccup
    // is treated as transient (retry once, no warning); two-in-a-row is `lost`.
    let failureStreak = 0;

    const schedule = (delay: number) => {
      if (cancelled) return;
      timer = setTimeout(tick, delay);
    };

    const onSuccess = (s: EditLockState) => {
      if (cancelled) return;
      setState(s);
      setResolved(true);
      if (s.lockedByOther) {
        // Server confirms someone else holds the lock — we've lost it. Stay in
        // the loop (auto-reclaim once they release or the lease expires) but
        // mark the editor so it can surface the lost-lock UX.
        failureStreak += 1;
        setHealth('lost');
        schedule(DOCUMENT_LOCK_HEARTBEAT_MS);
        return;
      }
      // We hold it — back to healthy and reset the failure counter so the next
      // hiccup starts the unstable→lost ladder cleanly.
      failureStreak = 0;
      setHealth('healthy');
      schedule(nextRefreshDelay(s.expiresAt));
    };

    const onFailure = () => {
      if (cancelled) return;
      setResolved(true);
      failureStreak += 1;
      if (failureStreak === 1) {
        // One transient hiccup — retry quickly. Expose `unstable` so callers
        // can render a subtle indicator without alarming the user yet.
        setHealth('unstable');
        schedule(LOCK_RETRY_BACKOFF_MS);
        return;
      }
      // Repeated failures — assume we lost the lease. Keep ticking on the
      // regular heartbeat cadence so we recover when the network comes back.
      setHealth('lost');
      schedule(DOCUMENT_LOCK_HEARTBEAT_MS);
    };

    const tick = () => {
      timer = undefined;
      client.acquire(resourceId, ownerId).then(onSuccess).catch(onFailure);
    };

    tick();

    // Kick a fresh heartbeat as soon as the browser comes back online or the
    // user refocuses the tab. Without this, a tab that lost connectivity sits
    // in `unstable`/`lost` until the next scheduled tick — possibly many seconds
    // after the user is already typing again.
    const refresh = () => {
      if (cancelled) return;
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      tick();
    };
    // Fire a best-effort release on `pagehide`. React's effect cleanup runs on
    // unmount but the navigation often aborts the in-flight release request, so
    // the lease lingers until expiry — which is exactly what triggers the
    // "Lin is editing this document" self-conflict on a refresh. Releasing here
    // (before the unload commits) gives the request a much better chance to
    // reach the server. `pagehide` is also fired by the bfcache path that
    // `unmount` misses.
    let released = false;
    const releaseOnce = () => {
      if (released || cancelled) return;
      released = true;
      client.release(resourceId, ownerId).catch(() => {});
    };
    const supportsWindow = typeof window !== 'undefined';
    if (supportsWindow) {
      window.addEventListener('online', refresh);
      window.addEventListener('focus', refresh);
      window.addEventListener('pagehide', releaseOnce);
    }

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (supportsWindow) {
        window.removeEventListener('online', refresh);
        window.removeEventListener('focus', refresh);
        window.removeEventListener('pagehide', releaseOnce);
      }
      setState(UNLOCKED);
      setHealth('healthy');
      if (!released) {
        released = true;
        client.release(resourceId, ownerId).catch(() => {});
      }
    };
  }, [engaged, resourceId, client, ownerId]);

  return { ...state, health, pending: active && !resolved };
};

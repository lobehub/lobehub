import type { MatrixApiClient } from './api';
import type { MatrixRoomEvent, MatrixSyncResponse, MatrixWebhookPayload } from './types';

export type SyncLogger = (...args: any[]) => void;

const noop: SyncLogger = () => {};

/** Long-poll timeout for each `/sync` request. */
const SYNC_TIMEOUT_MS = 30_000;
/** Backoff bounds for transient `/sync` failures. */
const RECONNECT_BASE_DELAY_MS = 1_000;
const RECONNECT_MAX_DELAY_MS = 60_000;

/**
 * Sync filter: cap the initial timeline, drop presence/typing noise. Account
 * data (for `m.direct`) and invites are delivered regardless of this filter.
 */
const SYNC_FILTER = JSON.stringify({
  presence: { types: [] },
  room: { ephemeral: { types: [] }, timeline: { limit: 20 } },
});

export interface MatrixSyncOptions {
  /** AbortSignal that ends the loop (provided by the platform client). */
  abortSignal?: AbortSignal;
  /** Bot's own MXID — events from this sender are skipped to avoid echo loops. */
  botUserId: string;
  /** Wall-clock ceiling; the loop resolves after this so the caller can refresh. */
  durationMs?: number;
  log?: SyncLogger;
  /** Internal endpoint each inbound message event is POSTed to. */
  webhookUrl: string;
}

/**
 * Maintains a persistent Matrix `/sync` long-poll loop and forwards each
 * inbound `m.room.message` to the internal webhook endpoint — the same
 * decoupled "persistent connection → webhook → Chat SDK" shape QQ/Discord use
 * for their gateways, so the rest of the bot pipeline is transport-agnostic.
 *
 * Also auto-accepts room invites (joins on `m.room.member` invite events).
 */
export class MatrixSyncConnection {
  private readonly api: MatrixApiClient;
  private readonly botUserId: string;
  private readonly webhookUrl: string;
  private readonly abortSignal?: AbortSignal;
  private readonly durationMs?: number;
  private readonly log: SyncLogger;

  /** Rooms known to be 1:1 DMs (from `m.direct` account data / invite flags). */
  private readonly directRoomIds = new Set<string>();
  private since: string | null = null;
  private stopped = false;

  constructor(api: MatrixApiClient, options: MatrixSyncOptions) {
    this.api = api;
    this.botUserId = options.botUserId;
    this.webhookUrl = options.webhookUrl;
    this.abortSignal = options.abortSignal;
    this.durationMs = options.durationMs;
    this.log = options.log ?? noop;
  }

  /**
   * Fast initial sync (`timeout=0`) to seed `next_batch`, **discarding** the
   * historical backlog so the bot only reacts to messages received while
   * online. Throws on failure (bad/revoked token) so the caller can mark the
   * provider failed before entering the long-poll loop.
   */
  async bootstrap(): Promise<void> {
    const initial = await this.api.sync({ signal: this.abortSignal, timeout: 0 });
    this.since = initial.next_batch;
    this.ingestAccountData(initial);
    await this.acceptInvites(initial);
  }

  /**
   * Long-poll loop. Runs until aborted or `durationMs` elapses (the caller
   * then refreshes). Transient `/sync` failures back off exponentially.
   * Call {@link bootstrap} first.
   */
  async poll(): Promise<void> {
    const deadline = this.durationMs ? Date.now() + this.durationMs : undefined;
    let backoff = RECONNECT_BASE_DELAY_MS;

    while (!this.isAborted()) {
      if (deadline && Date.now() >= deadline) {
        this.log('Sync duration elapsed, yielding for refresh');
        return;
      }

      try {
        const res = await this.api.sync({
          filter: SYNC_FILTER,
          signal: this.abortSignal,
          since: this.since ?? undefined,
          timeout: SYNC_TIMEOUT_MS,
        });
        backoff = RECONNECT_BASE_DELAY_MS;
        this.since = res.next_batch;
        this.ingestAccountData(res);
        await this.acceptInvites(res);
        await this.dispatchMessages(res);
      } catch (error) {
        if (this.isAborted()) return;
        this.log('Sync error, backing off %dms: %O', backoff, error);
        await this.delay(backoff);
        backoff = Math.min(backoff * 2, RECONNECT_MAX_DELAY_MS);
      }
    }
  }

  stop(): void {
    this.stopped = true;
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  /** Track DM rooms from the `m.direct` account-data event. */
  private ingestAccountData(res: MatrixSyncResponse): void {
    const events = res.account_data?.events ?? [];
    for (const event of events) {
      if (event.type !== 'm.direct') continue;
      const map = event.content as Record<string, unknown>;
      for (const roomIds of Object.values(map)) {
        if (Array.isArray(roomIds)) {
          for (const roomId of roomIds) {
            if (typeof roomId === 'string') this.directRoomIds.add(roomId);
          }
        }
      }
    }
  }

  /** Auto-accept every pending invite surfaced by `/sync`. */
  private async acceptInvites(res: MatrixSyncResponse): Promise<void> {
    const invites = res.rooms?.invite ?? {};
    for (const [roomId, data] of Object.entries(invites)) {
      const inviteEvents = data.invite_state?.events ?? [];
      const isDirect = inviteEvents.some(
        (e) =>
          e.type === 'm.room.member' &&
          e.sender !== this.botUserId &&
          (e.content as Record<string, unknown>)?.is_direct === true,
      );
      if (isDirect) this.directRoomIds.add(roomId);
      try {
        await this.api.joinRoom(roomId);
        this.log('Auto-joined room %s (direct=%s)', roomId, isDirect);
      } catch (error) {
        this.log('Failed to join room %s: %O', roomId, error);
      }
    }
  }

  /** Forward each inbound `m.room.message` (not from the bot) to the webhook. */
  private async dispatchMessages(res: MatrixSyncResponse): Promise<void> {
    const joined = res.rooms?.join ?? {};
    for (const [roomId, room] of Object.entries(joined)) {
      const events = room.timeline?.events ?? [];
      const memberCount = room.summary?.['m.joined_member_count'];
      const isDirect = this.directRoomIds.has(roomId) || (memberCount != null && memberCount <= 2);
      for (const event of events) {
        if (event.type !== 'm.room.message') continue;
        if (event.sender === this.botUserId) continue;
        // Skip edits/reaction-fallbacks so we don't reprocess an edited message.
        if (event.content?.['m.relates_to']?.rel_type === 'm.replace') continue;
        await this.forward(roomId, event, isDirect, memberCount);
      }
    }
  }

  private async forward(
    roomId: string,
    event: MatrixRoomEvent,
    isDirect: boolean,
    joinedMemberCount?: number,
  ): Promise<void> {
    const payload: MatrixWebhookPayload = {
      event,
      is_direct: isDirect,
      joined_member_count: joinedMemberCount,
      room_id: roomId,
    };
    try {
      await fetch(this.webhookUrl, {
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      this.log('Failed to forward event %s to webhook: %O', event.event_id, error);
    }
  }

  private isAborted(): boolean {
    return this.stopped || this.abortSignal?.aborted === true;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      this.abortSignal?.addEventListener('abort', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}

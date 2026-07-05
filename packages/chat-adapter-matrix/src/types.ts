// ---------- Adapter config ----------

export interface MatrixAdapterConfig {
  /**
   * Long-lived bot **access token**. Either supplied directly by the operator
   * or obtained by the platform client via `m.login.password` before the
   * adapter is constructed.
   */
  readonly accessToken: string;
  /**
   * Optional Client-Server API base path override. Matrix endpoints already
   * carry their own `/_matrix/...` prefix, so this is just the homeserver
   * origin (e.g. `https://matrix.org`). No trailing slash required.
   */
  readonly homeserverUrl: string;
  /**
   * The bot's Matrix user ID (`@bot:server.org`). Used as the bot identity,
   * to skip the bot's own echo events during `/sync`, and as the route
   * segment for the forwarded webhook.
   */
  readonly userId: string;
  /** Optional display name override for the Chat SDK bot identity. */
  readonly userName?: string;
}

/** Decoded thread identity. A Matrix "thread" maps 1:1 to a room. */
export interface MatrixThreadId {
  /** True for 1:1 DM rooms — encoded into the thread id so `isDM` is stateless. */
  isDirect?: boolean;
  /** Full Matrix room ID, e.g. `!aBcD:server.org` (contains a colon). */
  roomId: string;
}

// ---------- Client-Server API: events ----------

/** Message content body (subset of the `m.room.message` schema we consume). */
export interface MatrixMessageContent {
  [extra: string]: unknown;
  body?: string;
  /** Original filename for `m.file` payloads. */
  filename?: string;
  /** Present for `org.matrix.custom.html` formatted messages. */
  format?: string;
  formatted_body?: string;
  /** Media metadata for `m.image` / `m.file` / `m.video` / `m.audio`. */
  info?: {
    mimetype?: string;
    size?: number;
    [extra: string]: unknown;
  };
  /** Replacement content carried by `m.replace` edits. */
  ['m.new_content']?: MatrixMessageContent;
  /** Edit / reply / reaction relation. */
  ['m.relates_to']?: {
    event_id?: string;
    key?: string;
    rel_type?: string;
    ['m.in_reply_to']?: { event_id?: string };
  };
  /**
   * `m.text` | `m.notice` | `m.emote` | `m.image` | `m.file` | `m.video` |
   * `m.audio` | ...
   */
  msgtype?: string;
  /** `mxc://server/mediaId` for media messages. */
  url?: string;
}

/** A raw room event as delivered by `/sync` or `/messages`. */
export interface MatrixRoomEvent {
  content: MatrixMessageContent;
  event_id: string;
  origin_server_ts?: number;
  sender: string;
  /** e.g. `m.room.message`, `m.room.member`, `m.reaction`. */
  type: string;
}

// ---------- Forwarded webhook payload ----------

/**
 * Shape the {@link MatrixSyncConnection} forwards to the internal webhook
 * endpoint, and that {@link MatrixAdapter.handleWebhook} parses. We carry the
 * room context (`is_direct`, member count) alongside the event because the
 * webhook handler is stateless and cannot re-derive it.
 */
export interface MatrixWebhookPayload {
  event: MatrixRoomEvent;
  /** True when the room is a 1:1 DM (from invite `is_direct` or 2 members). */
  is_direct?: boolean;
  /** Joined member count from the room summary, when known. */
  joined_member_count?: number;
  room_id: string;
}

// ---------- Client-Server API: responses ----------

export interface MatrixLoginResponse {
  access_token: string;
  device_id?: string;
  user_id: string;
}

export interface MatrixWhoamiResponse {
  device_id?: string;
  is_guest?: boolean;
  user_id: string;
}

export interface MatrixSendEventResponse {
  event_id: string;
}

export interface MatrixErrorBody {
  errcode?: string;
  error?: string;
}

/** Minimal `/sync` response shape (only the parts the bot reads). */
export interface MatrixSyncResponse {
  account_data?: { events?: MatrixRoomEvent[] };
  next_batch: string;
  rooms?: {
    invite?: Record<string, { invite_state?: { events?: MatrixRoomEvent[] } }>;
    join?: Record<
      string,
      {
        summary?: { ['m.joined_member_count']?: number };
        timeline?: { events?: MatrixRoomEvent[]; limited?: boolean; prev_batch?: string };
      }
    >;
  };
}

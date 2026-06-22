import type {
  MatrixErrorBody,
  MatrixLoginResponse,
  MatrixMessageContent,
  MatrixSendEventResponse,
  MatrixSyncResponse,
  MatrixWhoamiResponse,
} from './types';

/** Client-Server API version prefix used for all stable endpoints. */
const CS_V3 = '/_matrix/client/v3';

/**
 * Hand-rolled Matrix Client-Server API client (`fetch`-based, no SDK).
 *
 * Stateless beyond the access token + transaction counter — cheap to create.
 * All methods throw on HTTP failure with the Matrix error envelope's
 * `errcode: error` so 401/403/429 surface an operator-facing reason.
 *
 * Only the slice of the spec the bot needs is implemented: login, whoami,
 * `/sync`, send/edit/redact events, reactions, typing, room join, and
 * authenticated media download.
 *
 * @see https://spec.matrix.org/latest/client-server-api/
 */
export class MatrixApiClient {
  readonly accessToken: string;
  readonly homeserverUrl: string;

  private txnCounter = 0;

  constructor(options: { accessToken: string; homeserverUrl: string }) {
    this.accessToken = options.accessToken;
    this.homeserverUrl = stripTrailingSlashes(options.homeserverUrl);
  }

  // ------------------------------------------------------------------
  // Auth
  // ------------------------------------------------------------------

  /**
   * Log in with username + password (`m.login.password`) and obtain an access
   * token. Static because it runs before a client (and its token) exists.
   * @see https://spec.matrix.org/latest/client-server-api/#password-based
   */
  static async login(options: {
    deviceDisplayName?: string;
    homeserverUrl: string;
    password: string;
    user: string;
  }): Promise<MatrixLoginResponse> {
    const base = stripTrailingSlashes(options.homeserverUrl);
    // Matrix accepts either a bare localpart or a full `@user:server` MXID in
    // the `m.id.user` identifier; pass through whatever the operator typed.
    const localpart = options.user.startsWith('@')
      ? options.user.slice(1).split(':')[0]
      : options.user;
    const res = await fetch(`${base}${CS_V3}/login`, {
      body: JSON.stringify({
        identifier: { type: 'm.id.user', user: localpart },
        initial_device_display_name: options.deviceDisplayName ?? 'LobeHub',
        password: options.password,
        type: 'm.login.password',
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    return parseResponse<MatrixLoginResponse>(res, 'login');
  }

  /**
   * Resolve the user ID a supplied access token belongs to. Used by
   * `validateCredentials` and `start()` to fail fast on a revoked/typo token.
   * @see https://spec.matrix.org/latest/client-server-api/#get_matrixclientv3accountwhoami
   */
  async whoami(): Promise<MatrixWhoamiResponse> {
    const res = await fetch(`${this.homeserverUrl}${CS_V3}/account/whoami`, {
      headers: this.authHeaders,
      method: 'GET',
    });
    return parseResponse<MatrixWhoamiResponse>(res, 'whoami');
  }

  // ------------------------------------------------------------------
  // Sync
  // ------------------------------------------------------------------

  /**
   * Long-poll `/sync`. With `since` omitted this returns a fast initial
   * snapshot (the caller passes `timeout=0` and discards old timeline events,
   * keeping only `next_batch`). Subsequent calls long-poll up to `timeout` ms.
   * @see https://spec.matrix.org/latest/client-server-api/#get_matrixclientv3sync
   */
  async sync(options: {
    filter?: string;
    signal?: AbortSignal;
    since?: string;
    timeout?: number;
  }): Promise<MatrixSyncResponse> {
    const params = new URLSearchParams();
    if (options.since) params.set('since', options.since);
    if (options.timeout != null) params.set('timeout', String(options.timeout));
    if (options.filter) params.set('filter', options.filter);
    const res = await fetch(`${this.homeserverUrl}${CS_V3}/sync?${params.toString()}`, {
      headers: this.authHeaders,
      method: 'GET',
      signal: options.signal,
    });
    return parseResponse<MatrixSyncResponse>(res, 'sync');
  }

  // ------------------------------------------------------------------
  // Rooms & messages
  // ------------------------------------------------------------------

  /**
   * Join a room by ID or alias. Idempotent — joining an already-joined room
   * succeeds. Used to auto-accept invites surfaced by `/sync`.
   * @see https://spec.matrix.org/latest/client-server-api/#post_matrixclientv3joinroomidoralias
   */
  async joinRoom(roomIdOrAlias: string): Promise<{ room_id: string }> {
    const res = await fetch(
      `${this.homeserverUrl}${CS_V3}/join/${encodeURIComponent(roomIdOrAlias)}`,
      { body: '{}', headers: this.authHeaders, method: 'POST' },
    );
    return parseResponse<{ room_id: string }>(res, 'joinRoom');
  }

  /**
   * Send an `m.room.message` event. Uses `PUT .../send/{type}/{txnId}` with a
   * unique transaction ID so retries are de-duplicated server-side.
   * @see https://spec.matrix.org/latest/client-server-api/#put_matrixclientv3roomsroomidsendeventtypetxnid
   */
  async sendMessage(
    roomId: string,
    content: MatrixMessageContent,
  ): Promise<MatrixSendEventResponse> {
    return this.sendEvent(roomId, 'm.room.message', content);
  }

  /**
   * Edit a previously sent message via an `m.replace` relation. Matrix renders
   * the fallback `body` (prefixed `* `) on clients that don't support edits and
   * the `m.new_content` on those that do.
   * @see https://spec.matrix.org/latest/client-server-api/#event-replacements
   */
  async editMessage(
    roomId: string,
    eventId: string,
    content: MatrixMessageContent,
  ): Promise<MatrixSendEventResponse> {
    const fallbackBody = content.body ?? '';
    const newContent: MatrixMessageContent = { ...content };
    delete newContent['m.relates_to'];
    delete newContent['m.new_content'];
    return this.sendEvent(roomId, 'm.room.message', {
      ...content,
      body: `* ${fallbackBody}`,
      formatted_body: content.formatted_body ? `* ${content.formatted_body}` : undefined,
      ['m.new_content']: newContent,
      ['m.relates_to']: { event_id: eventId, rel_type: 'm.replace' },
    });
  }

  /**
   * Add an emoji reaction to an event via an `m.annotation` relation.
   * @see https://spec.matrix.org/latest/client-server-api/#mannotation-relationship-type
   */
  async sendReaction(
    roomId: string,
    eventId: string,
    key: string,
  ): Promise<MatrixSendEventResponse> {
    return this.sendEvent(roomId, 'm.reaction', {
      ['m.relates_to']: { event_id: eventId, key, rel_type: 'm.annotation' },
    });
  }

  /**
   * Redact an event (used to remove a previously sent reaction).
   * @see https://spec.matrix.org/latest/client-server-api/#put_matrixclientv3roomsroomidredacteventidtxnid
   */
  async redactEvent(roomId: string, eventId: string): Promise<MatrixSendEventResponse> {
    const txnId = this.nextTxnId();
    const res = await fetch(
      `${this.homeserverUrl}${CS_V3}/rooms/${encodeURIComponent(roomId)}/redact/${encodeURIComponent(eventId)}/${txnId}`,
      { body: '{}', headers: this.authHeaders, method: 'PUT' },
    );
    return parseResponse<MatrixSendEventResponse>(res, 'redactEvent');
  }

  /**
   * Set the bot's typing notification in a room. Best-effort.
   * @see https://spec.matrix.org/latest/client-server-api/#put_matrixclientv3roomsroomidtypinguserid
   */
  async sendTyping(
    roomId: string,
    userId: string,
    typing: boolean,
    timeout = 20_000,
  ): Promise<void> {
    const res = await fetch(
      `${this.homeserverUrl}${CS_V3}/rooms/${encodeURIComponent(roomId)}/typing/${encodeURIComponent(userId)}`,
      {
        body: JSON.stringify(typing ? { timeout, typing } : { typing }),
        headers: this.authHeaders,
        method: 'PUT',
      },
    );
    // Typing is non-critical; swallow non-OK to keep the messenger uniform.
    if (!res.ok) await res.text().catch(() => undefined);
  }

  /**
   * Download media bytes for an `mxc://` URI. Prefers the authenticated media
   * endpoint (`/_matrix/client/v1/media/download`, spec v1.11+) and falls back
   * to the legacy unauthenticated route for older homeservers.
   * @see https://spec.matrix.org/latest/client-server-api/#get_matrixclientv1mediadownloadservernamemediaid
   */
  async downloadMedia(mxcUrl: string): Promise<Buffer> {
    const parsed = parseMxc(mxcUrl);
    if (!parsed) throw new Error(`Invalid mxc URL: ${mxcUrl}`);
    const { mediaId, serverName } = parsed;

    const authedUrl = `${this.homeserverUrl}/_matrix/client/v1/media/download/${encodeURIComponent(serverName)}/${encodeURIComponent(mediaId)}`;
    let res = await fetch(authedUrl, { headers: this.authHeaders, method: 'GET' });

    // Older homeservers (pre-1.11) return 404/400 on the authenticated route —
    // retry the legacy media endpoint before giving up.
    if (res.status === 404 || res.status === 400) {
      const legacyUrl = `${this.homeserverUrl}/_matrix/media/v3/download/${encodeURIComponent(serverName)}/${encodeURIComponent(mediaId)}`;
      res = await fetch(legacyUrl, { headers: this.authHeaders, method: 'GET' });
    }

    if (!res.ok) {
      const detail = await safeReadError(res);
      throw new Error(detail || `downloadMedia ${mxcUrl} failed with HTTP ${res.status}`);
    }
    return Buffer.from(await res.arrayBuffer());
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  private async sendEvent(
    roomId: string,
    eventType: string,
    content: MatrixMessageContent | Record<string, unknown>,
  ): Promise<MatrixSendEventResponse> {
    const txnId = this.nextTxnId();
    const res = await fetch(
      `${this.homeserverUrl}${CS_V3}/rooms/${encodeURIComponent(roomId)}/send/${eventType}/${txnId}`,
      { body: JSON.stringify(content), headers: this.authHeaders, method: 'PUT' },
    );
    return parseResponse<MatrixSendEventResponse>(res, `sendEvent(${eventType})`);
  }

  private nextTxnId(): string {
    this.txnCounter += 1;
    return `lobehub_${Date.now()}_${this.txnCounter}`;
  }

  private get authHeaders(): Record<string, string> {
    return {
      'Authorization': `Bearer ${this.accessToken}`,
      'Content-Type': 'application/json',
    };
  }
}

/** Split an `mxc://server/mediaId` URI into its parts. */
export function parseMxc(mxcUrl: string): { mediaId: string; serverName: string } | undefined {
  if (!mxcUrl?.startsWith('mxc://')) return undefined;
  const rest = mxcUrl.slice('mxc://'.length);
  const slash = rest.indexOf('/');
  if (slash === -1) return undefined;
  const serverName = rest.slice(0, slash);
  const mediaId = rest.slice(slash + 1);
  if (!serverName || !mediaId) return undefined;
  return { mediaId, serverName };
}

function stripTrailingSlashes(url: string): string {
  let end = url.length;
  while (end > 0 && url[end - 1] === '/') end--;
  return url.slice(0, end);
}

async function parseResponse<T>(response: Response, label: string): Promise<T> {
  const text = await response.text();
  let payload: T | undefined;
  try {
    payload = text ? (JSON.parse(text) as T) : undefined;
  } catch {
    payload = undefined;
  }

  if (!response.ok) {
    const errMsg = readErrorMessage(payload as MatrixErrorBody | undefined);
    throw new Error(errMsg || `${label} failed with HTTP ${response.status}`);
  }

  return (payload ?? ({} as T)) as T;
}

async function safeReadError(response: Response): Promise<string | undefined> {
  try {
    const text = await response.text();
    if (!text) return undefined;
    return readErrorMessage(JSON.parse(text) as MatrixErrorBody);
  } catch {
    return undefined;
  }
}

function readErrorMessage(payload: MatrixErrorBody | undefined): string | undefined {
  if (!payload) return undefined;
  if (payload.errcode && payload.error) return `${payload.errcode}: ${payload.error}`;
  return payload.error ?? payload.errcode;
}

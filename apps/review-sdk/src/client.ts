/**
 * The toolbar's link to LobeHub: the approval popup handshake and the review
 * API. The only credential is the acceptance-review token the reviewer
 * approved in the popup; it is scoped to one acceptance and this page's
 * origin, so it is kept for the tab (sessionStorage) and dropped at expiry.
 */

/** Keep in sync with `src/features/Auth/AcceptanceReviewConnect/protocol.ts` in LobeHub. */
export const SESSION_MESSAGE = 'lobehub:acceptance-review:session';
export const DENIED_MESSAGE = 'lobehub:acceptance-review:denied';

export type Capability = 'comment' | 'reject';

export interface ReviewSession {
  acceptance: { id: string; status: string; title: string };
  capabilities: Capability[];
  expiresAt: string;
  token: string;
}

export interface PageSource {
  commit?: string;
  consoleErrors?: string[];
  elementText?: string;
  extra?: Record<string, boolean | number | string>;
  kind: 'product-page';
  rect?: { height: number; width: number; x: number; y: number };
  selector?: string;
  title?: string;
  url: string;
  userAgent?: string;
  viewport?: { height: number; width: number };
}

export interface Remark {
  attachments: { id: string; name?: string; url?: string }[];
  content: string;
  createdAt: string;
  id: string;
  source: PageSource | null;
}

export interface RepairDispatch {
  dispatched: boolean;
  error?: string;
  reason?: string;
}

export class ReviewError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
  }
}

interface StorageLike {
  getItem: (key: string) => string | null;
  removeItem: (key: string) => void;
  setItem: (key: string, value: string) => void;
}

export interface ReviewClientOptions {
  acceptanceId: string;
  fetch?: typeof fetch;
  /** The LobeHub origin, e.g. https://app.lobehub.com */
  server: string;
  storage?: StorageLike | null;
}

const HANDOFF_POLL_MS = 1500;
const HANDOFF_GRACE_MS = 60_000;
/** The server keeps a parked session for five minutes. */
const HANDOFF_TIMEOUT_MS = 5 * 60_000;

/** 32 random bytes, base64url — the one-time id a parked session is claimed with. */
export const randomHandoffId = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
};

/** Seconds of slack so a request never leaves with a token about to lapse. */
const EXPIRY_MARGIN_MS = 30_000;

export class ReviewClient {
  readonly server: string;
  readonly acceptanceId: string;
  private session: ReviewSession | null = null;
  private readonly fetchImpl: typeof fetch;
  private readonly storage: StorageLike | null;

  constructor(options: ReviewClientOptions) {
    this.server = new URL(options.server).origin;
    this.acceptanceId = options.acceptanceId;
    this.fetchImpl = options.fetch ?? ((...args) => fetch(...args));
    this.storage =
      options.storage === undefined
        ? typeof sessionStorage === 'undefined'
          ? null
          : sessionStorage
        : options.storage;
    this.session = this.restore();
  }

  private get storageKey() {
    return `lobehub-review:${this.server}:${this.acceptanceId}`;
  }

  private restore(): ReviewSession | null {
    try {
      const raw = this.storage?.getItem(this.storageKey);
      const session = raw ? (JSON.parse(raw) as ReviewSession) : null;
      return session && this.isLive(session) ? session : null;
    } catch {
      return null;
    }
  }

  private isLive(session: ReviewSession) {
    return new Date(session.expiresAt).getTime() - EXPIRY_MARGIN_MS > Date.now();
  }

  /** The approved session, if it is still valid. */
  current(): ReviewSession | null {
    if (this.session && !this.isLive(this.session)) this.forget();
    return this.session;
  }

  forget() {
    this.session = null;
    this.storage?.removeItem(this.storageKey);
  }

  /** Accept a session posted back by the popup — only from the LobeHub origin, only of our shape. */
  acceptMessage(event: { data: unknown; origin: string }): ReviewSession | 'denied' | null {
    if (event.origin !== this.server) return null;
    const data = event.data as Partial<ReviewSession> & { type?: string };
    if (data?.type === DENIED_MESSAGE) return 'denied';
    if (
      data?.type !== SESSION_MESSAGE ||
      typeof data.token !== 'string' ||
      data.acceptance?.id !== this.acceptanceId ||
      typeof data.expiresAt !== 'string' ||
      !Array.isArray(data.capabilities)
    )
      return null;
    const session: ReviewSession = {
      acceptance: data.acceptance,
      capabilities: data.capabilities,
      expiresAt: data.expiresAt,
      token: data.token,
    };
    this.session = session;
    this.storage?.setItem(this.storageKey, JSON.stringify(session));
    return session;
  }

  connectUrl(pageOrigin: string, handoff?: string) {
    const url = new URL('/oauth/acceptance-review', this.server);
    url.searchParams.set('acceptance', this.acceptanceId);
    url.searchParams.set('origin', pageOrigin);
    if (handoff) url.searchParams.set('handoff', handoff);
    return url.toString();
  }

  /** Pick up a session the approval page parked under `handoff`; null until approved. */
  async claimHandoff(handoff: string): Promise<ReviewSession | null> {
    const response = await this.fetchImpl(
      `${this.server}/api/acceptance-review/handoff?id=${encodeURIComponent(handoff)}`,
    ).catch(() => null);
    if (!response?.ok) return null;
    const data = (await response.json().catch(() => null)) as unknown;
    const session = this.acceptMessage({
      data: { ...(data as object), type: SESSION_MESSAGE },
      origin: this.server,
    });
    return session && session !== 'denied' ? session : null;
  }

  /**
   * Open the approval popup and wait for the reviewer's answer. Two channels:
   * the popup posts the session back to its opener, and — because a sign-in
   * through an IdP with Cross-Origin-Opener-Policy cuts that link (and makes
   * `popup.closed` read true while the reviewer is still signing in) — the
   * session is also parked server-side under a one-time id this page polls.
   */
  connect(options: { signal?: AbortSignal } = {}): Promise<ReviewSession> {
    const handoff = randomHandoffId();
    const popup = window.open(
      this.connectUrl(window.location.origin, handoff),
      'lobehub-review-connect',
      'popup,width=460,height=640',
    );
    if (!popup) return Promise.reject(new ReviewError('Popup blocked', 'POPUP_BLOCKED', 0));
    return new Promise((resolve, reject) => {
      const startedAt = Date.now();
      let closedAt: number | null = null;
      let settled = false;
      const finish = (result: ReviewSession | ReviewError) => {
        if (settled) return;
        settled = true;
        window.removeEventListener('message', onMessage);
        clearInterval(timer);
        options.signal?.removeEventListener('abort', onAbort);
        if (result instanceof ReviewError) reject(result);
        else resolve(result);
      };
      const onMessage = (event: MessageEvent) => {
        if (event.source !== popup) return;
        const result = this.acceptMessage(event);
        if (!result) return;
        finish(result === 'denied' ? new ReviewError('Denied', 'DENIED', 0) : result);
      };
      const onAbort = () => finish(new ReviewError('Cancelled', 'CANCELLED', 0));
      const timer = setInterval(async () => {
        const session = await this.claimHandoff(handoff);
        if (session) return finish(session);
        if (popup.closed) closedAt ??= Date.now();
        // A closed popup may only look closed (COOP); give the handoff a grace
        // period before concluding the reviewer walked away.
        if (closedAt && Date.now() - closedAt > HANDOFF_GRACE_MS)
          finish(new ReviewError('Popup closed', 'CLOSED', 0));
        else if (Date.now() - startedAt > HANDOFF_TIMEOUT_MS)
          finish(new ReviewError('Timed out', 'TIMEOUT', 0));
      }, HANDOFF_POLL_MS);
      window.addEventListener('message', onMessage);
      options.signal?.addEventListener('abort', onAbort);
    });
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const session = this.current();
    if (!session) throw new ReviewError('Not authorized', 'UNAUTHORIZED', 401);
    const response = await this.fetchImpl(`${this.server}/api/acceptance-review/${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${session.token}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });
    const body = (await response.json().catch(() => ({}))) as T & {
      error?: { code: string; message: string };
    };
    if (!response.ok) {
      // A dead session is worth nothing kept: the next action asks again.
      if (response.status === 401) this.forget();
      throw new ReviewError(
        body.error?.message ?? `HTTP ${response.status}`,
        body.error?.code ?? 'ERROR',
        response.status,
      );
    }
    return body;
  }

  listMine() {
    return this.request<{ items: Remark[] }>('comments').then((body) => body.items);
  }

  create(input: { content: string; screenshot?: string | null; source: PageSource }) {
    return this.request<Remark>('comments', {
      body: JSON.stringify({ ...input, clientId: crypto.randomUUID() }),
      method: 'POST',
    });
  }

  remove(id: string) {
    return this.request<{ id: string }>(`comments/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  reject(comment?: string) {
    return this.request<{ repairDispatch: RepairDispatch; sentBack: number; status: string }>(
      'reject',
      {
        body: JSON.stringify({ comment: comment || undefined }),
        method: 'POST',
      },
    );
  }
}

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * A short-lived, single-purpose capability for joining one rewrite room.
 *
 * The claims are deliberately self-contained so a worker can carry the ticket
 * to the collaboration service without sharing a database credential. The
 * signed value is never persisted in the request row. `consume` also records
 * the nonce in this process, which closes replay within an instance; a
 * multi-instance deployment can provide a shared replay store at the room
 * boundary without changing the wire format.
 */
export const DOCUMENT_REWRITE_ROOM_TICKET_VERSION = 'lobe-rewrite-room-v1' as const;
export const DOCUMENT_REWRITE_ROOM_TICKET_CLIENT_KIND = 'agent' as const;
export const DOCUMENT_REWRITE_ROOM_TICKET_DEFAULT_TTL_MS = 5 * 60 * 1000;
export const DOCUMENT_REWRITE_ROOM_TICKET_MAX_TTL_MS = 15 * 60 * 1000;
export const DOCUMENT_REWRITE_ROOM_TICKET_MAX_BYTES = 8192;
export const DOCUMENT_REWRITE_ROOM_TICKET_MAX_CONSUMED_NONCES = 10_000;
export const DOCUMENT_REWRITE_ROOM_TICKET_CLOCK_SKEW_MS = 30_000;

export const DOCUMENT_REWRITE_ROOM_TICKET_INVALID = 'DOCUMENT_REWRITE_ROOM_TICKET_INVALID';
export const DOCUMENT_REWRITE_ROOM_TICKET_EXPIRED = 'DOCUMENT_REWRITE_ROOM_TICKET_EXPIRED';
export const DOCUMENT_REWRITE_ROOM_TICKET_REPLAYED = 'DOCUMENT_REWRITE_ROOM_TICKET_REPLAYED';
export const DOCUMENT_REWRITE_ROOM_TICKET_SECRET_MISSING =
  'DOCUMENT_REWRITE_ROOM_TICKET_SECRET_MISSING';
export const DOCUMENT_REWRITE_ROOM_TICKET_BINDING_MISMATCH =
  'DOCUMENT_REWRITE_ROOM_TICKET_BINDING_MISMATCH';

export interface DocumentRewriteRoomTicketClaims {
  agentId: string;
  attempt: number;
  clientKind: typeof DOCUMENT_REWRITE_ROOM_TICKET_CLIENT_KIND;
  documentId: string;
  exp: number;
  iat: number;
  nonce: string;
  requestId: string;
  roomId: string;
  userId: string;
  version: typeof DOCUMENT_REWRITE_ROOM_TICKET_VERSION;
  /** Opaque non-secret worker claim identity for deployment-side revalidation. */
  workerId?: string;
  workspaceId: string | null;
}

export interface IssueDocumentRewriteRoomTicketInput {
  agentId: string;
  attempt: number;
  /** A room ticket is valid for one agent client only. */
  clientKind?: typeof DOCUMENT_REWRITE_ROOM_TICKET_CLIENT_KIND;
  documentId: string;
  now?: number;
  requestId: string;
  roomId: string;
  ttlMs?: number;
  userId: string;
  /** Optional worker claim identity; required by the durable worker facade. */
  workerId?: string;
  workspaceId?: string | null;
}

export interface VerifyDocumentRewriteRoomTicketBinding {
  agentId?: string;
  attempt?: number;
  clientKind?: typeof DOCUMENT_REWRITE_ROOM_TICKET_CLIENT_KIND;
  documentId?: string;
  requestId?: string;
  roomId?: string;
  userId?: string;
  workerId?: string;
  workspaceId?: string | null;
}

export interface DocumentRewriteRoomTicketServiceOptions {
  now?: () => number;
  /** A deployment-wide atomic nonce store; the default is process-local MVP state. */
  replayStore?: DocumentRewriteRoomTicketReplayStore;
  secret?: string;
  ttlMs?: number;
}

export interface DocumentRewriteRoomTicketReplayStore {
  consume: (nonce: string, expiresAt: number, now: number) => boolean;
  prune: (now: number) => void;
}

export class DocumentRewriteRoomTicketError extends Error {
  constructor(
    public readonly code:
      | typeof DOCUMENT_REWRITE_ROOM_TICKET_BINDING_MISMATCH
      | typeof DOCUMENT_REWRITE_ROOM_TICKET_EXPIRED
      | typeof DOCUMENT_REWRITE_ROOM_TICKET_INVALID
      | typeof DOCUMENT_REWRITE_ROOM_TICKET_REPLAYED
      | typeof DOCUMENT_REWRITE_ROOM_TICKET_SECRET_MISSING,
    message: string = code,
  ) {
    super(message);
    this.name = 'DocumentRewriteRoomTicketError';
  }
}

const asBase64Url = (value: string | Uint8Array): string =>
  Buffer.from(value).toString('base64url');

const fromBase64Url = (value: string): Buffer => {
  if (!/^[\w-]+$/.test(value)) {
    throw new DocumentRewriteRoomTicketError(DOCUMENT_REWRITE_ROOM_TICKET_INVALID);
  }
  try {
    const decoded = Buffer.from(value, 'base64url');
    // Node accepts non-canonical spellings; reject padding/alternate forms.
    if (decoded.toString('base64url') !== value) throw new Error('non-canonical base64url');
    return decoded;
  } catch {
    throw new DocumentRewriteRoomTicketError(DOCUMENT_REWRITE_ROOM_TICKET_INVALID);
  }
};

const normalizeRequired = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 1024) {
    throw new DocumentRewriteRoomTicketError(
      DOCUMENT_REWRITE_ROOM_TICKET_INVALID,
      `${DOCUMENT_REWRITE_ROOM_TICKET_INVALID}: ${field}`,
    );
  }
  return value.trim();
};

const normalizeAttempt = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new DocumentRewriteRoomTicketError(
      DOCUMENT_REWRITE_ROOM_TICKET_INVALID,
      `${DOCUMENT_REWRITE_ROOM_TICKET_INVALID}: attempt`,
    );
  }
  return value;
};

const normalizeNow = (value: number | undefined, fallback: () => number): number => {
  const now = value ?? fallback();
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new DocumentRewriteRoomTicketError(
      DOCUMENT_REWRITE_ROOM_TICKET_INVALID,
      `${DOCUMENT_REWRITE_ROOM_TICKET_INVALID}: now`,
    );
  }
  return now;
};

const normalizeTtl = (value: number | undefined, defaultTtl: number): number => {
  const ttl = value ?? defaultTtl;
  if (!Number.isSafeInteger(ttl) || ttl < 1_000 || ttl > DOCUMENT_REWRITE_ROOM_TICKET_MAX_TTL_MS) {
    throw new DocumentRewriteRoomTicketError(
      DOCUMENT_REWRITE_ROOM_TICKET_INVALID,
      `${DOCUMENT_REWRITE_ROOM_TICKET_INVALID}: ttlMs`,
    );
  }
  return ttl;
};

const normalizeWorkspaceId = (value: unknown): string | null => {
  if (value === undefined || value === null) return null;
  return normalizeRequired(value, 'workspaceId');
};

const secretFromEnvironment = (): string | undefined =>
  process.env.DOCUMENT_REWRITE_TICKET_SECRET?.trim() || process.env.AUTH_SECRET?.trim();

const sign = (payload: string, secret: string): string =>
  asBase64Url(createHmac('sha256', secret).update(payload).digest());

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const validateClaims = (value: unknown): DocumentRewriteRoomTicketClaims => {
  if (!isRecord(value)) {
    throw new DocumentRewriteRoomTicketError(DOCUMENT_REWRITE_ROOM_TICKET_INVALID);
  }
  if (value.version !== DOCUMENT_REWRITE_ROOM_TICKET_VERSION) {
    throw new DocumentRewriteRoomTicketError(DOCUMENT_REWRITE_ROOM_TICKET_INVALID);
  }
  if (value.clientKind !== DOCUMENT_REWRITE_ROOM_TICKET_CLIENT_KIND) {
    throw new DocumentRewriteRoomTicketError(DOCUMENT_REWRITE_ROOM_TICKET_INVALID);
  }

  const workspaceId = normalizeWorkspaceId(value.workspaceId);

  const iat = value.iat;
  const exp = value.exp;
  if (
    typeof iat !== 'number' ||
    !Number.isSafeInteger(iat) ||
    typeof exp !== 'number' ||
    !Number.isSafeInteger(exp) ||
    exp <= iat
  ) {
    throw new DocumentRewriteRoomTicketError(DOCUMENT_REWRITE_ROOM_TICKET_INVALID);
  }

  return {
    agentId: normalizeRequired(value.agentId, 'agentId'),
    attempt: normalizeAttempt(value.attempt),
    clientKind: DOCUMENT_REWRITE_ROOM_TICKET_CLIENT_KIND,
    documentId: normalizeRequired(value.documentId, 'documentId'),
    exp,
    iat,
    nonce: normalizeRequired(value.nonce, 'nonce'),
    requestId: normalizeRequired(value.requestId, 'requestId'),
    roomId: normalizeRequired(value.roomId, 'roomId'),
    userId: normalizeRequired(value.userId, 'userId'),
    version: DOCUMENT_REWRITE_ROOM_TICKET_VERSION,
    workspaceId,
    ...(value.workerId === undefined
      ? {}
      : { workerId: normalizeRequired(value.workerId, 'workerId') }),
  };
};

const assertBinding = (
  claims: DocumentRewriteRoomTicketClaims,
  expected: VerifyDocumentRewriteRoomTicketBinding | undefined,
): void => {
  if (!expected) return;
  const entries: Array<[keyof VerifyDocumentRewriteRoomTicketBinding, unknown]> = [
    ['agentId', expected.agentId],
    ['attempt', expected.attempt],
    ['clientKind', expected.clientKind],
    ['documentId', expected.documentId],
    ['requestId', expected.requestId],
    ['roomId', expected.roomId],
    ['userId', expected.userId],
    ['workspaceId', expected.workspaceId],
    ['workerId', expected.workerId],
  ];
  for (const [key, value] of entries) {
    if (value !== undefined && claims[key] !== value) {
      throw new DocumentRewriteRoomTicketError(
        DOCUMENT_REWRITE_ROOM_TICKET_BINDING_MISMATCH,
        `${DOCUMENT_REWRITE_ROOM_TICKET_BINDING_MISMATCH}: ${key}`,
      );
    }
  }
};

export class DocumentRewriteRoomTicketService {
  private readonly defaultTtlMs: number;
  private readonly now: () => number;
  private readonly replayStore: DocumentRewriteRoomTicketReplayStore;
  private readonly secret?: string;

  constructor(options: DocumentRewriteRoomTicketServiceOptions = {}) {
    this.defaultTtlMs = normalizeTtl(options.ttlMs, DOCUMENT_REWRITE_ROOM_TICKET_DEFAULT_TTL_MS);
    this.now = options.now ?? Date.now;
    this.replayStore = options.replayStore ?? new MemoryReplayStore();
    this.secret = options.secret?.trim() || secretFromEnvironment();
  }

  private signingSecret = (): string => {
    const secret = this.secret || secretFromEnvironment();
    if (!secret) {
      throw new DocumentRewriteRoomTicketError(DOCUMENT_REWRITE_ROOM_TICKET_SECRET_MISSING);
    }
    return secret;
  };

  issue = (input: IssueDocumentRewriteRoomTicketInput): string => {
    const now = normalizeNow(input.now, this.now);
    const ttlMs = normalizeTtl(input.ttlMs, this.defaultTtlMs);
    const claims: DocumentRewriteRoomTicketClaims = {
      agentId: normalizeRequired(input.agentId, 'agentId'),
      attempt: normalizeAttempt(input.attempt),
      clientKind: (() => {
        if (
          input.clientKind !== undefined &&
          input.clientKind !== DOCUMENT_REWRITE_ROOM_TICKET_CLIENT_KIND
        ) {
          throw new DocumentRewriteRoomTicketError(
            DOCUMENT_REWRITE_ROOM_TICKET_INVALID,
            `${DOCUMENT_REWRITE_ROOM_TICKET_INVALID}: clientKind`,
          );
        }
        return DOCUMENT_REWRITE_ROOM_TICKET_CLIENT_KIND;
      })(),
      documentId: normalizeRequired(input.documentId, 'documentId'),
      exp: now + ttlMs,
      iat: now,
      nonce: asBase64Url(randomBytes(18)),
      requestId: normalizeRequired(input.requestId, 'requestId'),
      roomId: normalizeRequired(input.roomId, 'roomId'),
      userId: normalizeRequired(input.userId, 'userId'),
      version: DOCUMENT_REWRITE_ROOM_TICKET_VERSION,
      workspaceId: normalizeWorkspaceId(input.workspaceId),
      ...(input.workerId === undefined
        ? {}
        : { workerId: normalizeRequired(input.workerId, 'workerId') }),
    };
    const payload = asBase64Url(Buffer.from(JSON.stringify(claims), 'utf8'));
    return `${payload}.${sign(payload, this.signingSecret())}`;
  };

  verify = (
    token: string,
    expected?: VerifyDocumentRewriteRoomTicketBinding,
    now = this.now(),
  ): DocumentRewriteRoomTicketClaims => {
    if (
      typeof token !== 'string' ||
      token.length === 0 ||
      token.length > DOCUMENT_REWRITE_ROOM_TICKET_MAX_BYTES
    ) {
      throw new DocumentRewriteRoomTicketError(DOCUMENT_REWRITE_ROOM_TICKET_INVALID);
    }
    const parts = token.split('.');
    if (parts.length !== 2) {
      throw new DocumentRewriteRoomTicketError(DOCUMENT_REWRITE_ROOM_TICKET_INVALID);
    }
    const [encodedPayload, encodedSignature] = parts;
    const payloadBytes = fromBase64Url(encodedPayload);
    const actualSignature = fromBase64Url(encodedSignature);
    const expectedSignature = Buffer.from(sign(encodedPayload, this.signingSecret()), 'base64url');
    if (
      actualSignature.length !== expectedSignature.length ||
      !timingSafeEqual(actualSignature, expectedSignature)
    ) {
      throw new DocumentRewriteRoomTicketError(DOCUMENT_REWRITE_ROOM_TICKET_INVALID);
    }

    let rawClaims: unknown;
    try {
      rawClaims = JSON.parse(payloadBytes.toString('utf8'));
    } catch {
      throw new DocumentRewriteRoomTicketError(DOCUMENT_REWRITE_ROOM_TICKET_INVALID);
    }
    const claims = validateClaims(rawClaims);
    if (
      !Number.isSafeInteger(now) ||
      now < claims.iat - DOCUMENT_REWRITE_ROOM_TICKET_CLOCK_SKEW_MS
    ) {
      throw new DocumentRewriteRoomTicketError(DOCUMENT_REWRITE_ROOM_TICKET_INVALID);
    }
    if (now >= claims.exp) {
      throw new DocumentRewriteRoomTicketError(DOCUMENT_REWRITE_ROOM_TICKET_EXPIRED);
    }
    if (claims.exp - claims.iat > DOCUMENT_REWRITE_ROOM_TICKET_MAX_TTL_MS) {
      throw new DocumentRewriteRoomTicketError(DOCUMENT_REWRITE_ROOM_TICKET_INVALID);
    }
    assertBinding(claims, expected);
    return claims;
  };

  /** Verify and atomically consume a ticket. Calling this twice rejects replay. */
  consume = (
    token: string,
    expected?: VerifyDocumentRewriteRoomTicketBinding,
    now = this.now(),
  ): DocumentRewriteRoomTicketClaims => {
    const claims = this.verify(token, expected, now);
    this.replayStore.prune(now);
    if (!this.replayStore.consume(claims.nonce, claims.exp, now)) {
      throw new DocumentRewriteRoomTicketError(DOCUMENT_REWRITE_ROOM_TICKET_REPLAYED);
    }
    return claims;
  };

  /** Test/process-lifecycle helper; this never changes the signed token. */
  clearConsumed = (): void => this.replayStore.prune(Number.MAX_SAFE_INTEGER);
}

/** Bounded process-local fallback; production multi-instance hosts inject a shared atomic store. */
class MemoryReplayStore implements DocumentRewriteRoomTicketReplayStore {
  private readonly consumed = new Map<string, number>();

  consume = (nonce: string, expiresAt: number, now: number): boolean => {
    if (this.consumed.has(nonce)) return false;
    if (this.consumed.size >= DOCUMENT_REWRITE_ROOM_TICKET_MAX_CONSUMED_NONCES) {
      this.prune(now);
    }
    if (this.consumed.size >= DOCUMENT_REWRITE_ROOM_TICKET_MAX_CONSUMED_NONCES) {
      // Fail closed instead of evicting a live nonce and reopening replay.
      throw new DocumentRewriteRoomTicketError(
        DOCUMENT_REWRITE_ROOM_TICKET_REPLAYED,
        'Ticket replay store is full',
      );
    }
    this.consumed.set(nonce, expiresAt);
    return true;
  };

  prune = (now: number): void => {
    for (const [nonce, expiresAt] of this.consumed) {
      if (expiresAt <= now) this.consumed.delete(nonce);
    }
  };
}

export const documentRewriteRoomTicketService = new DocumentRewriteRoomTicketService();

export const issueDocumentRewriteRoomTicket = (
  input: IssueDocumentRewriteRoomTicketInput,
): string => documentRewriteRoomTicketService.issue(input);

export const verifyDocumentRewriteRoomTicket = (
  token: string,
  expected?: VerifyDocumentRewriteRoomTicketBinding,
): DocumentRewriteRoomTicketClaims => documentRewriteRoomTicketService.verify(token, expected);

export const consumeDocumentRewriteRoomTicket = (
  token: string,
  expected?: VerifyDocumentRewriteRoomTicketBinding,
): DocumentRewriteRoomTicketClaims => documentRewriteRoomTicketService.consume(token, expected);

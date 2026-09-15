import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Reusable, short-lived browser capability for one Page room.
 *
 * This deliberately has a different format and secret from
 * DocumentRewriteRoomTicketService. Browser reconnects must be able to reuse
 * or refresh this ticket, while an Agent worker ticket is single-use and bound
 * to a request/lease. No requestId, workerId, selection, or snapshot is
 * included here.
 */
export const DOCUMENT_COLLABORATION_BROWSER_TICKET_VERSION = 'lobe-page-browser-v1' as const;
export const DOCUMENT_COLLABORATION_BROWSER_TICKET_CLIENT_KIND = 'browser' as const;
export const DOCUMENT_COLLABORATION_BROWSER_TICKET_DEFAULT_TTL_MS = 10 * 60 * 1000;
export const DOCUMENT_COLLABORATION_BROWSER_TICKET_MAX_TTL_MS = 15 * 60 * 1000;
export const DOCUMENT_COLLABORATION_BROWSER_TICKET_MAX_BYTES = 8192;
export const DOCUMENT_COLLABORATION_BROWSER_TICKET_CLOCK_SKEW_MS = 30_000;

export const DOCUMENT_COLLABORATION_BROWSER_TICKET_INVALID =
  'DOCUMENT_COLLABORATION_BROWSER_TICKET_INVALID';
export const DOCUMENT_COLLABORATION_BROWSER_TICKET_EXPIRED =
  'DOCUMENT_COLLABORATION_BROWSER_TICKET_EXPIRED';
export const DOCUMENT_COLLABORATION_BROWSER_TICKET_SECRET_MISSING =
  'DOCUMENT_COLLABORATION_BROWSER_TICKET_SECRET_MISSING';
export const DOCUMENT_COLLABORATION_BROWSER_TICKET_BINDING_MISMATCH =
  'DOCUMENT_COLLABORATION_BROWSER_TICKET_BINDING_MISMATCH';

export interface DocumentCollaborationBrowserTicketClaims {
  canWrite: boolean;
  clientKind: typeof DOCUMENT_COLLABORATION_BROWSER_TICKET_CLIENT_KIND;
  documentId: string;
  exp: number;
  iat: number;
  nonce: string;
  roomId: string;
  userId: string;
  version: typeof DOCUMENT_COLLABORATION_BROWSER_TICKET_VERSION;
  workspaceId: string | null;
}

export interface IssueDocumentCollaborationBrowserTicketInput {
  canWrite?: boolean;
  documentId: string;
  now?: number;
  roomId?: string;
  ttlMs?: number;
  userId: string;
  workspaceId?: string | null;
}

export interface VerifyDocumentCollaborationBrowserTicketBinding {
  canWrite?: boolean;
  clientKind?: typeof DOCUMENT_COLLABORATION_BROWSER_TICKET_CLIENT_KIND;
  documentId?: string;
  roomId?: string;
  userId?: string;
  workspaceId?: string | null;
}

export interface DocumentCollaborationBrowserTicketServiceOptions {
  now?: () => number;
  secret?: string;
  ttlMs?: number;
}

export class DocumentCollaborationBrowserTicketError extends Error {
  constructor(
    public readonly code:
      | typeof DOCUMENT_COLLABORATION_BROWSER_TICKET_BINDING_MISMATCH
      | typeof DOCUMENT_COLLABORATION_BROWSER_TICKET_EXPIRED
      | typeof DOCUMENT_COLLABORATION_BROWSER_TICKET_INVALID
      | typeof DOCUMENT_COLLABORATION_BROWSER_TICKET_SECRET_MISSING,
    message: string = code,
  ) {
    super(message);
    this.name = 'DocumentCollaborationBrowserTicketError';
  }
}

const asBase64Url = (value: string | Uint8Array): string =>
  Buffer.from(value).toString('base64url');

const fromBase64Url = (value: string): Buffer => {
  if (!/^[\w-]+$/.test(value)) {
    throw new DocumentCollaborationBrowserTicketError(
      DOCUMENT_COLLABORATION_BROWSER_TICKET_INVALID,
    );
  }
  try {
    const decoded = Buffer.from(value, 'base64url');
    if (decoded.toString('base64url') !== value) throw new Error('non-canonical base64url');
    return decoded;
  } catch {
    throw new DocumentCollaborationBrowserTicketError(
      DOCUMENT_COLLABORATION_BROWSER_TICKET_INVALID,
    );
  }
};

const normalizeRequired = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 1024) {
    throw new DocumentCollaborationBrowserTicketError(
      DOCUMENT_COLLABORATION_BROWSER_TICKET_INVALID,
      `${DOCUMENT_COLLABORATION_BROWSER_TICKET_INVALID}: ${field}`,
    );
  }
  return value.trim();
};

const normalizeWorkspaceId = (value: unknown): string | null => {
  if (value === undefined || value === null) return null;
  return normalizeRequired(value, 'workspaceId');
};

const normalizeNow = (value: number | undefined, fallback: () => number): number => {
  const now = value ?? fallback();
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new DocumentCollaborationBrowserTicketError(
      DOCUMENT_COLLABORATION_BROWSER_TICKET_INVALID,
      `${DOCUMENT_COLLABORATION_BROWSER_TICKET_INVALID}: now`,
    );
  }
  return now;
};

const normalizeTtl = (value: number | undefined, defaultTtl: number): number => {
  const ttl = value ?? defaultTtl;
  if (
    !Number.isSafeInteger(ttl) ||
    ttl < 1_000 ||
    ttl > DOCUMENT_COLLABORATION_BROWSER_TICKET_MAX_TTL_MS
  ) {
    throw new DocumentCollaborationBrowserTicketError(
      DOCUMENT_COLLABORATION_BROWSER_TICKET_INVALID,
      `${DOCUMENT_COLLABORATION_BROWSER_TICKET_INVALID}: ttlMs`,
    );
  }
  return ttl;
};

const secretFromEnvironment = (): string | undefined =>
  process.env.DOCUMENT_COLLABORATION_BROWSER_TICKET_SECRET?.trim();

const sign = (payload: string, secret: string): string =>
  asBase64Url(createHmac('sha256', secret).update(payload).digest());

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const validateClaims = (value: unknown): DocumentCollaborationBrowserTicketClaims => {
  if (!isRecord(value)) {
    throw new DocumentCollaborationBrowserTicketError(
      DOCUMENT_COLLABORATION_BROWSER_TICKET_INVALID,
    );
  }
  if (value.version !== DOCUMENT_COLLABORATION_BROWSER_TICKET_VERSION) {
    throw new DocumentCollaborationBrowserTicketError(
      DOCUMENT_COLLABORATION_BROWSER_TICKET_INVALID,
    );
  }
  if (value.clientKind !== DOCUMENT_COLLABORATION_BROWSER_TICKET_CLIENT_KIND) {
    throw new DocumentCollaborationBrowserTicketError(
      DOCUMENT_COLLABORATION_BROWSER_TICKET_INVALID,
    );
  }
  if (Object.hasOwn(value, 'requestId') || Object.hasOwn(value, 'workerId')) {
    throw new DocumentCollaborationBrowserTicketError(
      DOCUMENT_COLLABORATION_BROWSER_TICKET_INVALID,
    );
  }

  const iat = value.iat;
  const exp = value.exp;
  if (
    typeof iat !== 'number' ||
    !Number.isSafeInteger(iat) ||
    typeof exp !== 'number' ||
    !Number.isSafeInteger(exp) ||
    exp <= iat ||
    typeof value.canWrite !== 'boolean'
  ) {
    throw new DocumentCollaborationBrowserTicketError(
      DOCUMENT_COLLABORATION_BROWSER_TICKET_INVALID,
    );
  }

  return {
    canWrite: value.canWrite,
    clientKind: DOCUMENT_COLLABORATION_BROWSER_TICKET_CLIENT_KIND,
    documentId: normalizeRequired(value.documentId, 'documentId'),
    exp,
    iat,
    nonce: normalizeRequired(value.nonce, 'nonce'),
    roomId: normalizeRequired(value.roomId, 'roomId'),
    userId: normalizeRequired(value.userId, 'userId'),
    version: DOCUMENT_COLLABORATION_BROWSER_TICKET_VERSION,
    workspaceId: normalizeWorkspaceId(value.workspaceId),
  };
};

const assertBinding = (
  claims: DocumentCollaborationBrowserTicketClaims,
  expected: VerifyDocumentCollaborationBrowserTicketBinding | undefined,
): void => {
  if (!expected) return;
  const entries: Array<[keyof VerifyDocumentCollaborationBrowserTicketBinding, unknown]> = [
    ['canWrite', expected.canWrite],
    ['clientKind', expected.clientKind],
    ['documentId', expected.documentId],
    ['roomId', expected.roomId],
    ['userId', expected.userId],
    ['workspaceId', expected.workspaceId],
  ];
  for (const [key, value] of entries) {
    if (value !== undefined && claims[key] !== value) {
      throw new DocumentCollaborationBrowserTicketError(
        DOCUMENT_COLLABORATION_BROWSER_TICKET_BINDING_MISMATCH,
        `${DOCUMENT_COLLABORATION_BROWSER_TICKET_BINDING_MISMATCH}: ${key}`,
      );
    }
  }
};

export class DocumentCollaborationBrowserTicketService {
  private readonly defaultTtlMs: number;
  private readonly now: () => number;
  private readonly secret?: string;

  constructor(options: DocumentCollaborationBrowserTicketServiceOptions = {}) {
    this.defaultTtlMs = normalizeTtl(
      options.ttlMs,
      DOCUMENT_COLLABORATION_BROWSER_TICKET_DEFAULT_TTL_MS,
    );
    this.now = options.now ?? Date.now;
    this.secret = options.secret?.trim() || secretFromEnvironment();
  }

  private signingSecret = (): string => {
    const secret = this.secret || secretFromEnvironment();
    if (!secret) {
      throw new DocumentCollaborationBrowserTicketError(
        DOCUMENT_COLLABORATION_BROWSER_TICKET_SECRET_MISSING,
      );
    }
    return secret;
  };

  issue = (input: IssueDocumentCollaborationBrowserTicketInput): string => {
    const now = normalizeNow(input.now, this.now);
    const ttlMs = normalizeTtl(input.ttlMs, this.defaultTtlMs);
    const documentId = normalizeRequired(input.documentId, 'documentId');
    const roomId = normalizeRequired(input.roomId ?? documentId, 'roomId');
    if (roomId !== documentId) {
      throw new DocumentCollaborationBrowserTicketError(
        DOCUMENT_COLLABORATION_BROWSER_TICKET_BINDING_MISMATCH,
        `${DOCUMENT_COLLABORATION_BROWSER_TICKET_BINDING_MISMATCH}: roomId`,
      );
    }
    const claims: DocumentCollaborationBrowserTicketClaims = {
      canWrite: input.canWrite ?? true,
      clientKind: DOCUMENT_COLLABORATION_BROWSER_TICKET_CLIENT_KIND,
      documentId,
      exp: now + ttlMs,
      iat: now,
      nonce: asBase64Url(randomBytes(18)),
      roomId,
      userId: normalizeRequired(input.userId, 'userId'),
      version: DOCUMENT_COLLABORATION_BROWSER_TICKET_VERSION,
      workspaceId: normalizeWorkspaceId(input.workspaceId),
    };
    const payload = asBase64Url(Buffer.from(JSON.stringify(claims), 'utf8'));
    return `${payload}.${sign(payload, this.signingSecret())}`;
  };

  verify = (
    token: string,
    expected?: VerifyDocumentCollaborationBrowserTicketBinding,
    now = this.now(),
  ): DocumentCollaborationBrowserTicketClaims => {
    if (
      typeof token !== 'string' ||
      token.length === 0 ||
      token.length > DOCUMENT_COLLABORATION_BROWSER_TICKET_MAX_BYTES
    ) {
      throw new DocumentCollaborationBrowserTicketError(
        DOCUMENT_COLLABORATION_BROWSER_TICKET_INVALID,
      );
    }
    const parts = token.split('.');
    if (parts.length !== 2) {
      throw new DocumentCollaborationBrowserTicketError(
        DOCUMENT_COLLABORATION_BROWSER_TICKET_INVALID,
      );
    }
    const [encodedPayload, encodedSignature] = parts;
    const payloadBytes = fromBase64Url(encodedPayload);
    const actualSignature = fromBase64Url(encodedSignature);
    const expectedSignature = Buffer.from(sign(encodedPayload, this.signingSecret()), 'base64url');
    if (
      actualSignature.length !== expectedSignature.length ||
      !timingSafeEqual(actualSignature, expectedSignature)
    ) {
      throw new DocumentCollaborationBrowserTicketError(
        DOCUMENT_COLLABORATION_BROWSER_TICKET_INVALID,
      );
    }

    let rawClaims: unknown;
    try {
      rawClaims = JSON.parse(payloadBytes.toString('utf8'));
    } catch {
      throw new DocumentCollaborationBrowserTicketError(
        DOCUMENT_COLLABORATION_BROWSER_TICKET_INVALID,
      );
    }
    const claims = validateClaims(rawClaims);
    if (
      !Number.isSafeInteger(now) ||
      now < claims.iat - DOCUMENT_COLLABORATION_BROWSER_TICKET_CLOCK_SKEW_MS
    ) {
      throw new DocumentCollaborationBrowserTicketError(
        DOCUMENT_COLLABORATION_BROWSER_TICKET_INVALID,
      );
    }
    if (now >= claims.exp) {
      throw new DocumentCollaborationBrowserTicketError(
        DOCUMENT_COLLABORATION_BROWSER_TICKET_EXPIRED,
      );
    }
    if (claims.exp - claims.iat > DOCUMENT_COLLABORATION_BROWSER_TICKET_MAX_TTL_MS) {
      throw new DocumentCollaborationBrowserTicketError(
        DOCUMENT_COLLABORATION_BROWSER_TICKET_INVALID,
      );
    }
    assertBinding(claims, expected);
    return claims;
  };
}

export interface DocumentCollaborationBrowserTicketVerifierInput {
  clientId?: number;
  clientKind: 'agent' | 'browser';
  documentId?: string;
  roomId: string;
  ticket?: string | null;
}

export interface DocumentCollaborationBrowserTicketVerifierOptions {
  authorize: (claims: DocumentCollaborationBrowserTicketClaims) => boolean | Promise<boolean>;
  ticketService?: DocumentCollaborationBrowserTicketService;
}

/**
 * Build the browser half of a room verifier. Browser tickets are reusable
 * across reconnects (`singleUse: false`), unlike Agent rewrite tickets.
 */
export const createDocumentCollaborationBrowserTicketVerifier = (
  options: DocumentCollaborationBrowserTicketVerifierOptions,
) => {
  if (typeof options.authorize !== 'function') {
    throw new Error('Browser collaboration ticket authorization callback is required');
  }
  const ticketService = options.ticketService ?? new DocumentCollaborationBrowserTicketService();

  return async (input: DocumentCollaborationBrowserTicketVerifierInput) => {
    if (input.clientKind !== 'browser' || typeof input.ticket !== 'string') return false;
    try {
      const claims = ticketService.verify(input.ticket, {
        clientKind: 'browser',
        documentId: input.documentId,
        roomId: input.roomId,
      });
      if (!(await options.authorize(claims))) return false;
      return {
        allowed: true,
        clientId: input.clientId,
        // The relay understands this as a reusable browser capability and
        // therefore does not place it in its single-use replay set.
        expiresAt: claims.exp,
        principal: {
          canWrite: claims.canWrite,
          clientKind: claims.clientKind,
          documentId: claims.documentId,
          roomId: claims.roomId,
          userId: claims.userId,
          workspaceId: claims.workspaceId,
        },
        singleUse: false,
        ticketId: claims.nonce,
      };
    } catch {
      return false;
    }
  };
};

/**
 * Compose browser and Agent ticket verifiers without allowing one ticket
 * family to authenticate as the other client kind.
 */
export const createDocumentCollaborationRoomTicketVerifier = (options: {
  agentVerifier?: (
    input: DocumentCollaborationBrowserTicketVerifierInput & {
      requestId?: string;
      workerId?: string;
    },
  ) => unknown | Promise<unknown>;
  browser: DocumentCollaborationBrowserTicketVerifierOptions;
}) => {
  const browserVerifier = createDocumentCollaborationBrowserTicketVerifier(options.browser);
  return async (
    input: DocumentCollaborationBrowserTicketVerifierInput & {
      requestId?: string;
      workerId?: string;
    },
  ) => {
    if (input.clientKind === 'browser') return browserVerifier(input);
    if (input.clientKind === 'agent' && options.agentVerifier) {
      return options.agentVerifier(input);
    }
    return false;
  };
};

export const documentCollaborationBrowserTicketService =
  new DocumentCollaborationBrowserTicketService();

export const issueDocumentCollaborationBrowserTicket = (
  input: IssueDocumentCollaborationBrowserTicketInput,
): string => documentCollaborationBrowserTicketService.issue(input);

export const verifyDocumentCollaborationBrowserTicket = (
  token: string,
  expected?: VerifyDocumentCollaborationBrowserTicketBinding,
): DocumentCollaborationBrowserTicketClaims =>
  documentCollaborationBrowserTicketService.verify(token, expected);

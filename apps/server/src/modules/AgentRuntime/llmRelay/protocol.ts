import { createHmac, timingSafeEqual } from 'node:crypto';

import type { LlmRelayDeadlines } from '@lobechat/agent-gateway-client';
import { LLM_RELAY_CAPABILITY, LLM_RELAY_LEASE_HEADER } from '@lobechat/agent-gateway-client';

/**
 * Shared constants and keys of the LLM relay: a server-driven agent loop hands
 * one LLM attempt to the user's device (`llm_execute`), and the device uploads
 * the attempt's protocol chunks back in batches over HTTP.
 *
 * Redis layout, all keyed by the attempt's `callId`:
 * - `llm_relay:payload:{callId}`  the request body the device fetches once
 * - `llm_relay:open:{callId}`     owning user id; present while the attempt runs
 * - `llm_relay:lease:{callId}`    client id that claimed the call (SET NX)
 * - `llm_relay:bytes:{callId}`    total uploaded bytes, for the per-call cap
 * - `llm_relay:cancel:{callId}`   the server no longer wants the attempt
 * - `llm_relay:stream:{callId}`   Redis Stream of uploaded batches (`seq`, `body`)
 */

export { LLM_RELAY_CAPABILITY, LLM_RELAY_LEASE_HEADER };

/** Upper bound of the whole attempt; keeps it inside a 600s step invocation. */
const MAX_TOTAL_MS = 540_000;

export const DEFAULT_LLM_RELAY_DEADLINES: LlmRelayDeadlines = {
  claimMs: 15_000,
  // Local models can take tens of seconds to load on the first request.
  firstChunkMs: 120_000,
  idleMs: 60_000,
  totalMs: MAX_TOTAL_MS,
};

/**
 * Room left before the invocation's kill time for cancelling and cleaning up
 * an attempt that hit its total deadline.
 */
export const LLM_RELAY_INVOCATION_MARGIN_MS = 30_000;

/** Shortest total deadline an attempt gets, however little budget is left. */
const MIN_TOTAL_MS = 15_000;

/**
 * The attempt's deadlines within what is left of the invocation: a step the
 * inline loop starts late cannot wait the full `totalMs`, or the host kills
 * the worker before it cancels the call and the device keeps generating.
 */
export const fitLlmRelayDeadlines = (
  deadlines: LlmRelayDeadlines,
  invocationDeadlineAt: number | undefined,
  now = Date.now(),
): LlmRelayDeadlines => {
  if (invocationDeadlineAt === undefined) return deadlines;

  const remaining = invocationDeadlineAt - now - LLM_RELAY_INVOCATION_MARGIN_MS;
  const totalMs = Math.min(deadlines.totalMs, Math.max(MIN_TOTAL_MS, remaining));
  return totalMs === deadlines.totalMs ? deadlines : { ...deadlines, totalMs };
};

/** Single uploaded batch, in bytes of the raw request body. */
export const LLM_RELAY_MAX_BATCH_BYTES = 256 * 1024;

/** Everything uploaded for one call. */
export const LLM_RELAY_MAX_CALL_BYTES = 16 * 1024 * 1024;

/** Batches kept in the stream; far above what one attempt produces at 5 batches/s. */
export const LLM_RELAY_STREAM_MAXLEN = 5000;

/** Keys outlive the attempt by this much, so late uploads get a clean `410`. */
export const LLM_RELAY_KEY_GRACE_MS = 60_000;

export const llmRelayKeys = {
  bytes: (callId: string) => `llm_relay:bytes:${callId}`,
  cancel: (callId: string) => `llm_relay:cancel:${callId}`,
  lease: (callId: string) => `llm_relay:lease:${callId}`,
  open: (callId: string) => `llm_relay:open:${callId}`,
  payload: (callId: string) => `llm_relay:payload:${callId}`,
  stream: (callId: string) => `llm_relay:stream:${callId}`,
};

/**
 * `generation` is a nonce per step execution: a step the queue redrives after
 * its worker died reruns with the same `operationId`/`stepIndex` and attempt
 * numbers, and must not reuse the dead execution's lease, stream or cancel keys.
 */
export const buildLlmRelayCallId = (
  operationId: string,
  stepIndex: number,
  generation: string,
  attempt: number,
) => `${operationId}:${stepIndex}:${generation}:${attempt}`;

// ─── Lease token ───

/**
 * The lease token is the capability for one call's relay endpoints. It only
 * travels in the `llm_execute` event, which reaches the run owner's own
 * authenticated gateway subscriptions, so holding it proves the uploader is
 * one of that user's clients. It is bound to the call and the user and expires
 * with the attempt; which of the user's clients executes is settled by the
 * first upload claiming the call (`llm_relay:lease:{callId}`).
 */
interface LeaseClaims {
  callId: string;
  exp: number;
  userId: string;
}

const getLeaseSecret = () => {
  const secret = process.env.KEY_VAULTS_SECRET;
  if (!secret) throw new Error('KEY_VAULTS_SECRET is required to sign LLM relay leases');
  return secret;
};

const sign = (body: string) =>
  createHmac('sha256', getLeaseSecret()).update(`llm-relay-lease:${body}`).digest('base64url');

export const signLlmRelayLease = (claims: LeaseClaims) => {
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${body}.${sign(body)}`;
};

export const verifyLlmRelayLease = (
  token: string | undefined | null,
  callId: string,
  now = Date.now(),
): LeaseClaims | undefined => {
  if (!token) return;

  const [body, signature] = token.split('.');
  if (!body || !signature) return;

  const expected = Buffer.from(sign(body));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return;

  try {
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString()) as LeaseClaims;
    if (claims.callId !== callId || typeof claims.userId !== 'string') return;
    if (typeof claims.exp !== 'number' || claims.exp < now) return;
    return claims;
  } catch {
    return;
  }
};

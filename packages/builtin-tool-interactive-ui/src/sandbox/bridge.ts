export const SANDBOX_BRIDGE_VERSION = 1;
export const MAX_PROPOSAL_LENGTH = 2000;
export const MAX_SANDBOX_PROPOSALS = 20;

export type SandboxMode = 'preview' | 'complete';

export interface SandboxProposal {
  requestId: string;
  sequence: number;
  text: string;
  token: string;
  type: 'proposal';
  version: typeof SANDBOX_BRIDGE_VERSION;
}

export interface SandboxMessageContext {
  frameWindow: MessageEventSource | null;
  lastSequence: number;
  mode: SandboxMode;
  seenRequestIds: ReadonlySet<string>;
  token: string;
}

export interface SandboxStatus {
  reason: 'unsupported' | 'runtime' | 'budget' | 'timeout' | 'expired';
  status: 'error' | 'paused';
  token: string;
  type: 'status';
  version: typeof SANDBOX_BRIDGE_VERSION;
}

/** A terminal status from trusted frame code; localize it outside the iframe. */
export const validateSandboxStatus = (
  event: Pick<MessageEvent<unknown>, 'data' | 'origin' | 'source'>,
  context: Pick<SandboxMessageContext, 'frameWindow' | 'mode' | 'token'>,
): SandboxStatus | null => {
  if (
    context.mode !== 'complete' ||
    !context.frameWindow ||
    !/^[\w-]{16,128}$/.test(context.token) ||
    event.source !== context.frameWindow ||
    event.origin !== 'null'
  )
    return null;

  const data = event.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const payload = data as Record<string, unknown>;
  if (
    Object.keys(payload).length !== 5 ||
    payload.version !== SANDBOX_BRIDGE_VERSION ||
    payload.type !== 'status' ||
    payload.token !== context.token ||
    typeof payload.reason !== 'string' ||
    !['unsupported', 'runtime', 'budget', 'timeout', 'expired'].includes(payload.reason) ||
    payload.status !== (['unsupported', 'runtime'].includes(payload.reason) ? 'error' : 'paused')
  )
    return null;

  return {
    reason: payload.reason as SandboxStatus['reason'],
    status: ['unsupported', 'runtime'].includes(payload.reason) ? 'error' : 'paused',
    token: context.token,
    type: 'status',
    version: SANDBOX_BRIDGE_VERSION,
  };
};

/**
 * The token identifies a mounted frame, not an authorization or a secret. A valid
 * proposal still needs the host's explicit user confirmation before any action.
 * The caller records the returned sequence/requestId before presenting a proposal.
 */
export const validateSandboxMessage = (
  event: Pick<MessageEvent<unknown>, 'data' | 'origin' | 'source'>,
  context: SandboxMessageContext,
): SandboxProposal | null => {
  if (
    context.mode !== 'complete' ||
    !context.frameWindow ||
    !/^[\w-]{16,128}$/.test(context.token) ||
    event.source !== context.frameWindow ||
    event.origin !== 'null' ||
    context.seenRequestIds.size >= MAX_SANDBOX_PROPOSALS
  )
    return null;

  const data = event.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const payload = data as Record<string, unknown>;

  if (
    Object.keys(payload).length !== 6 ||
    payload.version !== SANDBOX_BRIDGE_VERSION ||
    payload.type !== 'proposal' ||
    payload.token !== context.token ||
    typeof payload.requestId !== 'string' ||
    !/^[\w-]{1,64}$/.test(payload.requestId) ||
    context.seenRequestIds.has(payload.requestId) ||
    typeof payload.sequence !== 'number' ||
    !Number.isSafeInteger(payload.sequence) ||
    payload.sequence !== context.lastSequence + 1 ||
    payload.sequence > MAX_SANDBOX_PROPOSALS ||
    typeof payload.text !== 'string' ||
    payload.text.length > MAX_PROPOSAL_LENGTH ||
    !payload.text.trim()
  )
    return null;

  return {
    requestId: payload.requestId,
    sequence: payload.sequence,
    text: payload.text,
    token: context.token,
    type: 'proposal',
    version: SANDBOX_BRIDGE_VERSION,
  };
};

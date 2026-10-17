import { describe, expect, it } from 'vitest';

import type { SandboxMessageContext } from './bridge';
import {
  MAX_PROPOSAL_LENGTH,
  MAX_SANDBOX_PROPOSALS,
  validateSandboxMessage,
  validateSandboxStatus,
} from './bridge';

const frameWindow = {} as Window;
const token = 'test-frame-token-123456789';
const proposal = {
  requestId: 'proposal-1',
  sequence: 1,
  text: 'Compare the selected options',
  token,
  type: 'proposal',
  version: 1,
};
const context = (): SandboxMessageContext => ({
  frameWindow,
  lastSequence: 0,
  mode: 'complete',
  seenRequestIds: new Set(),
  token,
});

describe('sandbox terminal status boundary', () => {
  const status = { reason: 'budget', status: 'paused', token, type: 'status', version: 1 };

  it('accepts only fixed reason/status combinations from the current opaque frame', () => {
    expect(validateSandboxStatus(event(status), context())).toEqual(status);
    expect(
      validateSandboxStatus(event({ ...status, reason: 'runtime', status: 'error' }), context()),
    ).toEqual({ ...status, reason: 'runtime', status: 'error' });
    expect(validateSandboxStatus(event({ ...status, reason: 'runtime' }), context())).toBeNull();
    expect(validateSandboxStatus(event({ ...status, reason: '<script>' }), context())).toBeNull();
    expect(
      validateSandboxStatus(event({ ...status, text: 'Untrusted error message' }), context()),
    ).toBeNull();
    expect(validateSandboxStatus({ ...event(status), source: window }, context())).toBeNull();
    expect(
      validateSandboxStatus({ ...event(status), origin: 'https://example.com' }, context()),
    ).toBeNull();
    expect(validateSandboxStatus(event(status), { ...context(), mode: 'preview' })).toBeNull();
  });
});
const event = (data: unknown = proposal) => ({ data, origin: 'null', source: frameWindow });

describe('sandbox proposal boundary', () => {
  it('accepts an exact proposal from the current opaque frame', () => {
    expect(validateSandboxMessage(event(), context())).toEqual(proposal);
  });

  it('rejects other windows, origins, mounts and preview messages', () => {
    expect(validateSandboxMessage({ ...event(), source: window }, context())).toBeNull();
    expect(
      validateSandboxMessage({ ...event(), origin: 'https://example.com' }, context()),
    ).toBeNull();
    expect(validateSandboxMessage(event(), { ...context(), frameWindow: null })).toBeNull();
    expect(
      validateSandboxMessage(event(), { ...context(), token: 'different-frame-token' }),
    ).toBeNull();
    expect(validateSandboxMessage(event(), { ...context(), mode: 'preview' })).toBeNull();
  });

  it.each([
    null,
    [],
    'proposal',
    { ...proposal, type: 'sendMessage' },
    { ...proposal, type: 'callTool' },
    { ...proposal, version: 2 },
    { ...proposal, tool: 'execute' },
    { ...proposal, text: '' },
    { ...proposal, text: '   ' },
    { ...proposal, text: 'a'.repeat(MAX_PROPOSAL_LENGTH + 1) },
    { ...proposal, requestId: 'a'.repeat(65) },
    { ...proposal, requestId: '<script>' },
    { ...proposal, sequence: 0 },
    { ...proposal, sequence: 1.5 },
    { ...proposal, sequence: NaN },
    { ...proposal, sequence: Infinity },
    { ...proposal, sequence: 2 },
  ])('rejects malformed or unauthorized payload %j', (data) => {
    expect(validateSandboxMessage(event(data), context())).toBeNull();
  });

  it('requires a monotonically increasing sequence and an unseen request ID', () => {
    const previous = { ...context(), lastSequence: 1, seenRequestIds: new Set(['proposal-1']) };
    expect(validateSandboxMessage(event(), previous)).toBeNull();
    expect(validateSandboxMessage(event({ ...proposal, sequence: 2 }), previous)).toBeNull();
    expect(
      validateSandboxMessage(
        event({ ...proposal, requestId: 'proposal-2', sequence: 2 }),
        previous,
      ),
    ).toEqual({ ...proposal, requestId: 'proposal-2', sequence: 2 });
    expect(previous.seenRequestIds.size).toBe(1);
  });

  it('caps proposals for one mounted frame', () => {
    const ids = new Set(Array.from({ length: MAX_SANDBOX_PROPOSALS }, (_, i) => `proposal-${i}`));
    expect(validateSandboxMessage(event(), { ...context(), seenRequestIds: ids })).toBeNull();
  });
});

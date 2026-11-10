import { describe, expect, it } from 'vitest';

import { execAgentClientIdsSchema } from './execAgentClientIds';

describe('execAgentClientIdsSchema', () => {
  it('accepts a parent tail persisted in client mode with a bare nanoid id', () => {
    // A conversation that ran in client mode before switching to Gateway can
    // render such a row as its tail; rejecting it would block sending entirely.
    expect(
      execAgentClientIdsSchema.parse({ userMessageParentId: 'V1StGXR8_Z5jdHi6B-myT' }),
    ).toEqual({ userMessageParentId: 'V1StGXR8_Z5jdHi6B-myT' });
  });

  it('still rejects minted ids outside the messages namespace', () => {
    expect(() =>
      execAgentClientIdsSchema.parse({ userMessageId: 'V1StGXR8_Z5jdHi6B-myT' }),
    ).toThrow();
  });

  it('bounds the parent reference', () => {
    expect(() => execAgentClientIdsSchema.parse({ userMessageParentId: '' })).toThrow();
    expect(() =>
      execAgentClientIdsSchema.parse({ userMessageParentId: 'x'.repeat(256) }),
    ).toThrow();
  });
});

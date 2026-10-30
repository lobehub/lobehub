import { describe, expect, it } from 'vitest';

import { isBackendPath, isSandboxedBackendRequestAllowed } from '../protocol';

describe('isBackendPath', () => {
  // The renderer runs relayed local-model calls and uploads their output to
  // the remote server; served as a static asset instead, the claim gets a 404.
  it('proxies the LLM relay endpoints to the remote server', () => {
    expect(isBackendPath('/api/agent/llm-relay/op-1%3A0%3A1/payload')).toBe(true);
    expect(isBackendPath('/api/agent/llm-relay/op-1%3A0%3A1/chunks')).toBe(true);
  });

  it('keeps other /api/agent paths and lookalike prefixes local', () => {
    expect(isBackendPath('/api/agent/run')).toBe(false);
    expect(isBackendPath('/api/agent/llm-relayx')).toBe(false);
  });
});

describe('isSandboxedBackendRequestAllowed', () => {
  it('blocks opaque origins from authenticated backend paths', () => {
    expect(isSandboxedBackendRequestAllowed('null')).toBe(false);
    expect(isSandboxedBackendRequestAllowed(null)).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';

import { DSH_RUNTIME_CONFIG } from './dshRuntimeConfig';

describe('DSH_RUNTIME_CONFIG', () => {
  it('owns the complete SDK deployment without the upstream demo package', () => {
    expect(DSH_RUNTIME_CONFIG).toContain("name: '@deepseek-ai/dsh-sdk-jsonrpc-server'");
    expect(DSH_RUNTIME_CONFIG).toContain("name: '@deepseek-ai/dsh-agent-spine-demo'");
    expect(DSH_RUNTIME_CONFIG).toContain("name: '@deepseek-ai/dsh-session-persistence-jsonl'");
    expect(DSH_RUNTIME_CONFIG).not.toContain('dsh-sdk-jsonrpc-demo');
  });
});

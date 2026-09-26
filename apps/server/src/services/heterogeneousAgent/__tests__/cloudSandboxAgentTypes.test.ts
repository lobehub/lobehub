import { beforeEach, describe, expect, it, vi } from 'vitest';

import { sandboxEnv } from '@/envs/sandbox';

import { resolveCloudSandboxAgentTypes } from '../cloudSandboxAgentTypes';

vi.mock('@/envs/sandbox', () => ({
  sandboxEnv: { HETERO_SANDBOX_AGENT_TYPES: undefined },
}));

const configure = (value: string | undefined) => {
  (sandboxEnv as { HETERO_SANDBOX_AGENT_TYPES?: string }).HETERO_SANDBOX_AGENT_TYPES = value;
};

describe('resolveCloudSandboxAgentTypes', () => {
  beforeEach(() => configure(undefined));

  it('defaults to what the official runtime image ships', () => {
    expect(resolveCloudSandboxAgentTypes()).toEqual(['claude-code', 'codex']);
  });

  it('lets a deployment with its own image widen the set', () => {
    configure('claude-code,codex,opencode');

    expect(resolveCloudSandboxAgentTypes()).toEqual(['claude-code', 'codex', 'opencode']);
  });

  it('replaces the default rather than extending it, so an image can be narrowed', () => {
    configure('opencode');

    expect(resolveCloudSandboxAgentTypes()).toEqual(['opencode']);
  });

  it('tolerates spacing and empty entries', () => {
    configure('  opencode , , codex ');

    expect(resolveCloudSandboxAgentTypes()).toEqual(['opencode', 'codex']);
  });

  it('drops names that are not agent types, since the client renders this list', () => {
    configure('opencode,not-an-agent');

    expect(resolveCloudSandboxAgentTypes()).toEqual(['opencode']);
  });

  it('falls back to the default when nothing usable is configured', () => {
    configure('  , not-an-agent ,');

    expect(resolveCloudSandboxAgentTypes()).toEqual(['claude-code', 'codex']);
  });
});

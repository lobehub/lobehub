import { describe, expect, it } from 'vitest';

import {
  LocalExecutionHeterogeneousAgentTypeSchema,
  REMOTE_HETEROGENEOUS_AGENT_CONFIGS,
} from './agent/heterogeneousAgent';
import { isChannelRuntime, isRemoteChannelRuntime } from './channel';
import { channelMessageConnector } from './channelMessageCard';

describe('isChannelRuntime', () => {
  it('accepts LobeHub native execution', () => {
    expect(isChannelRuntime('native')).toBe(true);
  });

  it('accepts every runtime that executes on its user machine', () => {
    for (const type of LocalExecutionHeterogeneousAgentTypeSchema.options)
      expect(isChannelRuntime(type)).toBe(true);
    expect(isChannelRuntime('kimi-code')).toBe(true);
    expect(isChannelRuntime('deepseek-harness')).toBe(true);
  });

  it('accepts every remote-task runtime', () => {
    for (const { type } of REMOTE_HETEROGENEOUS_AGENT_CONFIGS) {
      expect(isChannelRuntime(type)).toBe(true);
      expect(isRemoteChannelRuntime(type)).toBe(true);
    }
  });

  it('marks only remote-task runtimes as remote', () => {
    expect(isRemoteChannelRuntime('native')).toBe(false);
    for (const type of LocalExecutionHeterogeneousAgentTypeSchema.options)
      expect(isRemoteChannelRuntime(type)).toBe(false);
  });

  it('rejects unknown runtimes', () => {
    expect(isChannelRuntime('unknown-cli')).toBe(false);
  });
});

describe('channelMessageConnector', () => {
  it('reads a catalog request without a url', () => {
    expect(
      channelMessageConnector({
        connector: { agentId: 'agt', identifier: 'github', name: 'GitHub', source: 'lobehub' },
      }),
    ).toEqual({
      agentId: 'agt',
      auth: null,
      identifier: 'github',
      name: 'GitHub',
      reason: null,
      source: 'lobehub',
      url: null,
    });
  });

  it('needs a url for a custom server and defaults its auth to none', () => {
    const connector = { agentId: 'agt', identifier: 'acme', source: 'custom' };
    expect(channelMessageConnector({ connector })).toBeUndefined();
    expect(
      channelMessageConnector({ connector: { ...connector, url: 'https://mcp.acme.dev' } }),
    ).toMatchObject({ auth: 'none', name: 'acme', url: 'https://mcp.acme.dev' });
  });

  it('ignores anything else', () => {
    expect(channelMessageConnector({})).toBeUndefined();
    expect(
      channelMessageConnector({ connector: { agentId: 'agt', identifier: 'x', source: 'other' } }),
    ).toBeUndefined();
  });
});

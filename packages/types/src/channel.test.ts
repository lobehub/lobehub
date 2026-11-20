import { describe, expect, it } from 'vitest';

import {
  LocalExecutionHeterogeneousAgentTypeSchema,
  REMOTE_HETEROGENEOUS_AGENT_CONFIGS,
} from './agent/heterogeneousAgent';
import { isChannelRuntime, isRemoteChannelRuntime } from './channel';

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

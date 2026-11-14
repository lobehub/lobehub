import { describe, expect, it } from 'vitest';

import {
  LocalExecutionHeterogeneousAgentTypeSchema,
  REMOTE_HETEROGENEOUS_AGENT_CONFIGS,
} from './agent/heterogeneousAgent';
import { CHANNEL_EXCLUDED_RUNTIMES, CHANNEL_RUNTIMES, isChannelRuntime } from './channel';

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

  it('excludes every remote-task runtime, each with a reason', () => {
    for (const { type } of REMOTE_HETEROGENEOUS_AGENT_CONFIGS) {
      expect(isChannelRuntime(type)).toBe(false);
      expect(CHANNEL_EXCLUDED_RUNTIMES[type]).toMatch(/remote-task/);
    }
  });

  it('never lists an excluded runtime as supported', () => {
    for (const type of Object.keys(CHANNEL_EXCLUDED_RUNTIMES))
      expect(CHANNEL_RUNTIMES as readonly string[]).not.toContain(type);
  });

  it('rejects unknown runtimes', () => {
    expect(isChannelRuntime('unknown-cli')).toBe(false);
  });
});

// @vitest-environment node
import type { LobeAgentAgencyConfig } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { translateSubAgentLegacyEffort } from '../agent/subAgentEffort';

const agency = (subagent: unknown) => ({ subagent }) as unknown as LobeAgentAgencyConfig;

describe('translateSubAgentLegacyEffort', () => {
  it('returns the same config object when the sub-agent carries no legacy effort key', () => {
    const config = agency({ chatConfig: {}, model: 'gpt-5.2', provider: 'openai' });

    // Nothing to translate: the caller keeps its own reference so the row it
    // holds is not rewritten on every read.
    expect(translateSubAgentLegacyEffort(config)).toBe(config);
  });

  it('passes a config without a sub-agent straight through', () => {
    expect(translateSubAgentLegacyEffort(null)).toBeNull();

    const empty = {} as LobeAgentAgencyConfig;
    expect(translateSubAgentLegacyEffort(empty)).toBe(empty);
  });

  it('moves a legacy per-model effort key to reasoningEffort without mutating the input', () => {
    const chatConfig = { gpt5_2ReasoningEffort: 'high' };
    const config = agency({ chatConfig, model: 'gpt-5.2', provider: 'openai' });

    const next = translateSubAgentLegacyEffort(config) as unknown as {
      subagent: { chatConfig: Record<string, unknown> };
    };

    expect(next).not.toBe(config);
    expect(next.subagent.chatConfig.gpt5_2ReasoningEffort).toBeUndefined();
    expect(next.subagent.chatConfig.reasoningEffort).toBe('high');
    expect(chatConfig).toEqual({ gpt5_2ReasoningEffort: 'high' });
  });

  it('treats a non-record chatConfig as nothing to translate', () => {
    const config = agency({ chatConfig: 'legacy', model: 'gpt-5.2', provider: 'openai' });

    expect(translateSubAgentLegacyEffort(config)).toBe(config);
  });
});

import { ENABLE_BUSINESS_FEATURES } from '@lobechat/business-const';
import { describe, expect, it } from 'vitest';

import { CLAUDE_OPUS_4_8_MODEL, CLAUDE_OPUS_4_8_PROVIDER } from './starterModels';

describe('starter models', () => {
  it('uses the Anthropic provider in OSS and the LobeHub provider in business builds', () => {
    expect(CLAUDE_OPUS_4_8_MODEL).toBe('claude-opus-4-8');
    expect(CLAUDE_OPUS_4_8_PROVIDER).toBe(ENABLE_BUSINESS_FEATURES ? 'lobehub' : 'anthropic');
  });
});

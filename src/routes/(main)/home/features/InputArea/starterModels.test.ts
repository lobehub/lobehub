import { ENABLE_BUSINESS_FEATURES } from '@lobechat/business-const';
import { describe, expect, it } from 'vitest';

import { NEW_CHAT_MODEL, NEW_CHAT_PROVIDER } from './starterModels';

describe('starter models', () => {
  it('uses the Anthropic provider in OSS and the LobeHub provider in business builds', () => {
    expect(NEW_CHAT_MODEL).toBe('claude-opus-4-8');
    expect(NEW_CHAT_PROVIDER).toBe(ENABLE_BUSINESS_FEATURES ? 'lobehub' : 'anthropic');
  });
});

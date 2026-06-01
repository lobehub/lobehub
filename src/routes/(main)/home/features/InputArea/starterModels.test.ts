import { ENABLE_BUSINESS_FEATURES } from '@lobechat/business-const';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_HOME_NEW_MODELS,
  NEW_CHAT_MODEL,
  NEW_CHAT_PROVIDER,
  NEW_MINIMAX_PROVIDER,
} from './starterModels';

describe('starter models', () => {
  it('uses the Anthropic provider in OSS and the LobeHub provider in business builds', () => {
    expect(NEW_CHAT_MODEL).toBe('claude-opus-4-8');
    expect(NEW_CHAT_PROVIDER).toBe(ENABLE_BUSINESS_FEATURES ? 'lobehub' : 'anthropic');
    expect(NEW_MINIMAX_PROVIDER).toBe(ENABLE_BUSINESS_FEATURES ? 'lobehub' : 'minimax');
  });

  it('keeps the fallback home new model entries in the current product order', () => {
    const sharedItems = [
      {
        model: 'claude-opus-4-8',
        provider: NEW_CHAT_PROVIDER,
        title: 'Claude Opus 4.8',
        type: 'chat',
      },
      {
        model: 'gpt-image-2',
        title: 'GPT Image 2',
        type: 'image',
      },
      {
        model: 'dreamina-seedance-2-0-260128',
        title: 'Seedance 2.0',
        type: 'video',
      },
    ];

    expect(DEFAULT_HOME_NEW_MODELS).toEqual(
      ENABLE_BUSINESS_FEATURES
        ? [
            {
              model: 'MiniMax-M3',
              provider: NEW_MINIMAX_PROVIDER,
              title: 'MiniMax M3',
              type: 'chat',
            },
            ...sharedItems,
          ]
        : sharedItems,
    );
  });
});

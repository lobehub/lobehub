import { describe, expect, it } from 'vitest';

import {
  isGPT5ProResponsesModel,
  isGPT5ResponsesModel,
  isOpenAIComputerUseModel,
  isOpenAIReasoningPayloadModel,
  isResponsesAPIModel,
  isResponsesAPIRequiredModel,
  parseOpenAIModelId,
  responsesAPIModels,
  supportsGPT5ResponsesReasoningEffortNone,
  supportsOpenAIServiceTierFlex,
} from './modelId';

describe('parseOpenAIModelId', () => {
  it('should parse native GPT model ids', () => {
    expect(parseOpenAIModelId('gpt-5.6-sol')).toEqual({
      family: 'gpt',
      majorVersion: 5,
      minorVersion: 6,
      modifiers: ['sol'],
      normalizedModelId: 'gpt-5.6-sol',
      source: 'openai',
    });
  });

  it('should parse GPT codex model modifiers', () => {
    expect(parseOpenAIModelId('gpt-5.1-codex-mini')).toEqual({
      family: 'gpt',
      majorVersion: 5,
      minorVersion: 1,
      modifiers: ['codex', 'mini'],
      normalizedModelId: 'gpt-5.1-codex-mini',
      source: 'openai',
    });
  });

  it('should parse OpenRouter OpenAI ids', () => {
    expect(parseOpenAIModelId('openai/gpt-5.6-terra')).toEqual({
      family: 'gpt',
      majorVersion: 5,
      minorVersion: 6,
      modifiers: ['terra'],
      normalizedModelId: 'gpt-5.6-terra',
      source: 'openRouter',
    });
  });

  it('should parse Codex-prefixed OpenAI ids', () => {
    expect(parseOpenAIModelId('codex/gpt-5.6-luna')).toEqual({
      family: 'gpt',
      majorVersion: 5,
      minorVersion: 6,
      modifiers: ['luna'],
      normalizedModelId: 'gpt-5.6-luna',
      source: 'codex',
    });
  });

  it('should not treat release dates as minor versions', () => {
    expect(parseOpenAIModelId('gpt-5-pro-2025-10-06')).toEqual({
      family: 'gpt',
      majorVersion: 5,
      modifiers: ['pro'],
      normalizedModelId: 'gpt-5-pro-2025-10-06',
      source: 'openai',
    });
  });

  it('should return undefined for non-GPT ids', () => {
    expect(parseOpenAIModelId('claude-opus-4-1')).toBeUndefined();
  });
});

describe('isGPT5ResponsesModel', () => {
  it('should preserve current base GPT-5 chat-completions models', () => {
    expect(isGPT5ResponsesModel('gpt-5')).toBe(false);
    expect(isGPT5ResponsesModel('gpt-5-chat-latest')).toBe(false);
    expect(isGPT5ResponsesModel('gpt-5.2-chat-latest')).toBe(false);
    expect(isGPT5ResponsesModel('gpt-5.3-chat-latest')).toBe(false);
    expect(isResponsesAPIModel('gpt-5.2-chat-latest')).toBe(false);
  });

  it('should match existing GPT-5 Responses models', () => {
    expect(isGPT5ResponsesModel('gpt-5-mini')).toBe(true);
    expect(isGPT5ResponsesModel('gpt-5-mini-2025-08-07')).toBe(true);
    expect(isGPT5ResponsesModel('gpt-5-foo-mini')).toBe(false);
    expect(isGPT5ResponsesModel('gpt-5-pro')).toBe(true);
    expect(isGPT5ResponsesModel('gpt-5-pro-2025-10-06')).toBe(true);
    expect(isGPT5ResponsesModel('gpt-5.1-codex-mini')).toBe(true);
    expect(isGPT5ResponsesModel('gpt-5.2')).toBe(true);
    expect(isGPT5ResponsesModel('gpt-5.4-mini')).toBe(true);
    expect(isGPT5ResponsesModel('gpt-5.5-pro')).toBe(true);
  });

  it('should match the GPT-5.6 family without allowlist entries', () => {
    expect(isGPT5ResponsesModel('gpt-5.6')).toBe(true);
    expect(isGPT5ResponsesModel('gpt-5.6-sol')).toBe(true);
    expect(isGPT5ResponsesModel('gpt-5.6-terra')).toBe(true);
    expect(isGPT5ResponsesModel('gpt-5.6-luna')).toBe(true);
  });

  it('should match Codex-prefixed GPT-5.6 models', () => {
    expect(isGPT5ResponsesModel('codex/gpt-5.6-luna')).toBe(true);
    expect(isResponsesAPIModel('codex/gpt-5.6-luna')).toBe(true);
  });

  it('should not force OpenRouter GPT slugs into the built-in Responses API rules', () => {
    expect(isGPT5ResponsesModel('openai/gpt-5.6-terra')).toBe(false);
    expect(isResponsesAPIModel('openai/gpt-5.6-terra')).toBe(false);
  });

  it('should not match non-GPT-5 ids', () => {
    expect(isGPT5ResponsesModel('gpt-4o')).toBe(false);
    expect(isGPT5ResponsesModel('gpt-6')).toBe(false);
    expect(isGPT5ResponsesModel('o3-pro')).toBe(false);
  });
});

describe('isResponsesAPIRequiredModel', () => {
  it('should require Responses API for models with no chat/completions endpoint', () => {
    // Static exceptions
    expect(isResponsesAPIRequiredModel('o1-pro')).toBe(true);
    expect(isResponsesAPIRequiredModel('o3-pro')).toBe(true);
    expect(isResponsesAPIRequiredModel('o3-deep-research')).toBe(true);
    expect(isResponsesAPIRequiredModel('o4-mini-deep-research')).toBe(true);
    expect(isResponsesAPIRequiredModel('codex-mini-latest')).toBe(true);
    expect(isResponsesAPIRequiredModel('computer-use-preview')).toBe(true);

    // GPT-5 pro / codex variants
    expect(isResponsesAPIRequiredModel('gpt-5-pro')).toBe(true);
    expect(isResponsesAPIRequiredModel('gpt-5-pro-2025-10-06')).toBe(true);
    expect(isResponsesAPIRequiredModel('gpt-5.5-pro')).toBe(true);
    expect(isResponsesAPIRequiredModel('gpt-5.1-codex-mini')).toBe(true);
  });

  it('should not require Responses API for models that also speak chat/completions', () => {
    // These are in responsesAPIModels (preferred) but work over chat/completions,
    // so the user's enableResponseApi toggle must be able to opt out of them.
    expect(isResponsesAPIRequiredModel('gpt-5-mini')).toBe(false);
    expect(isResponsesAPIRequiredModel('gpt-5.2')).toBe(false);
    expect(isResponsesAPIRequiredModel('gpt-5.4-mini')).toBe(false);
    expect(isResponsesAPIRequiredModel('gpt-5.6')).toBe(false);
    expect(isResponsesAPIRequiredModel('gpt-5.6-sol')).toBe(false);

    // Chat variants and plain models are never Responses-only
    expect(isResponsesAPIRequiredModel('gpt-5-chat-latest')).toBe(false);
    expect(isResponsesAPIRequiredModel('gpt-5.5-chat-latest')).toBe(false);
    expect(isResponsesAPIRequiredModel('gpt-4o')).toBe(false);
  });

  it('should not force OpenRouter GPT slugs into the required set', () => {
    expect(isResponsesAPIRequiredModel('openai/gpt-5.5-pro')).toBe(false);
    expect(isResponsesAPIRequiredModel('openai/gpt-5.1-codex-mini')).toBe(false);
  });

  it('should require Responses API for Codex-namespaced ids', () => {
    // `codex/gpt-*` gateways only expose the Responses contract, so the user's
    // enableResponseApi opt-out must not reroute them to /chat/completions.
    expect(isResponsesAPIRequiredModel('codex/gpt-5.6-luna')).toBe(true);
    expect(isResponsesAPIRequiredModel('codex/gpt-5.6')).toBe(true);
    expect(isResponsesAPIRequiredModel('codex/gpt-5-mini')).toBe(true);

    // Chat variants stay out of the required set, keeping required a subset of preferred.
    expect(isResponsesAPIRequiredModel('codex/gpt-5-chat-latest')).toBe(false);
    expect(isResponsesAPIModel('codex/gpt-5-chat-latest')).toBe(false);
  });

  it('should be a subset of isResponsesAPIModel', () => {
    // Invariant: anything required is also part of the broader "defaults to
    // Responses API" set, so consumers reading only the superset (Azure, GitHub
    // Copilot, src/services/chat) stay correct without knowing about the new tier.
    const samples = [
      ...responsesAPIModels,
      'gpt-5-pro',
      'gpt-5.5-pro',
      'gpt-5.1-codex-mini',
      'gpt-5-mini',
      'gpt-5.2',
      'gpt-5.6-sol',
      'gpt-5-chat-latest',
      'gpt-4o',
      'openai/gpt-5.5-pro',
      'codex/gpt-5.6-luna',
      'codex/gpt-5.6',
      'codex/gpt-5',
      'codex/gpt-5-chat-latest',
    ];

    for (const model of samples) {
      if (isResponsesAPIRequiredModel(model)) {
        expect(isResponsesAPIModel(model)).toBe(true);
      }
    }
  });
});

describe('isGPT5ProResponsesModel', () => {
  it('should match GPT-5 pro variants', () => {
    expect(isGPT5ProResponsesModel('gpt-5-pro')).toBe(true);
    expect(isGPT5ProResponsesModel('gpt-5.5-pro')).toBe(true);
  });

  it('should not match non-pro GPT-5 variants', () => {
    expect(isGPT5ProResponsesModel('gpt-5.6')).toBe(false);
    expect(isGPT5ProResponsesModel('gpt-5.6-sol')).toBe(false);
    expect(isGPT5ProResponsesModel('gpt-5.6-terra')).toBe(false);
    expect(isGPT5ProResponsesModel('gpt-5.6-luna')).toBe(false);
    expect(isGPT5ProResponsesModel('openai/gpt-5.5-pro')).toBe(false);
  });
});

describe('supportsGPT5ResponsesReasoningEffortNone', () => {
  it('should support none reasoning effort for non-pro GPT-5 minor models', () => {
    expect(supportsGPT5ResponsesReasoningEffortNone('gpt-5.6')).toBe(true);
    expect(supportsGPT5ResponsesReasoningEffortNone('gpt-5.6-sol')).toBe(true);
    expect(supportsGPT5ResponsesReasoningEffortNone('gpt-5.6-terra')).toBe(true);
    expect(supportsGPT5ResponsesReasoningEffortNone('gpt-5.6-luna')).toBe(true);
  });

  it('should preserve unsupported cases', () => {
    expect(supportsGPT5ResponsesReasoningEffortNone('gpt-5')).toBe(false);
    expect(supportsGPT5ResponsesReasoningEffortNone('gpt-5.5-pro')).toBe(false);
    expect(supportsGPT5ResponsesReasoningEffortNone('openai/gpt-5.6')).toBe(false);
    expect(supportsGPT5ResponsesReasoningEffortNone('gpt-4o')).toBe(false);
  });
});

describe('isOpenAIReasoningPayloadModel', () => {
  it('should match OpenAI reasoning families that need payload pruning', () => {
    expect(isOpenAIReasoningPayloadModel('o1-preview')).toBe(true);
    expect(isOpenAIReasoningPayloadModel('o3-pro')).toBe(true);
    expect(isOpenAIReasoningPayloadModel('o4-mini')).toBe(true);
    expect(isOpenAIReasoningPayloadModel('codex-mini-latest')).toBe(true);
    expect(isOpenAIReasoningPayloadModel('computer-use-preview')).toBe(true);
    expect(isOpenAIReasoningPayloadModel('gpt-5.6-luna')).toBe(true);
    expect(isOpenAIReasoningPayloadModel('codex/gpt-5.6-luna')).toBe(true);
    expect(isOpenAIReasoningPayloadModel('openai/gpt-5.6-sol')).toBe(true);
  });

  it('should preserve unsupported cases', () => {
    expect(isOpenAIReasoningPayloadModel('gpt-4o')).toBe(false);
    expect(isOpenAIReasoningPayloadModel('o3mini')).toBe(false);
  });
});

describe('isOpenAIComputerUseModel', () => {
  it('should match computer-use models across OpenAI prefixes', () => {
    expect(isOpenAIComputerUseModel('computer-use-preview')).toBe(true);
    expect(isOpenAIComputerUseModel('openai/computer-use-preview')).toBe(true);
  });

  it('should not match unrelated models', () => {
    expect(isOpenAIComputerUseModel('gpt-5.6-sol')).toBe(false);
  });
});

describe('supportsOpenAIServiceTierFlex', () => {
  it('should support flex tier model families', () => {
    expect(supportsOpenAIServiceTierFlex('gpt-5.6-sol')).toBe(true);
    expect(supportsOpenAIServiceTierFlex('openai/gpt-5.6-terra')).toBe(true);
    expect(supportsOpenAIServiceTierFlex('o3-pro')).toBe(true);
    expect(supportsOpenAIServiceTierFlex('o4-mini')).toBe(true);
  });

  it('should preserve unsupported flex tier cases', () => {
    expect(supportsOpenAIServiceTierFlex('o3-mini')).toBe(false);
    expect(supportsOpenAIServiceTierFlex('gpt-4o')).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';

import {
  isGPTProResponsesModel,
  isGPTResponsesModel,
  isOpenAIComputerUseModel,
  isOpenAIReasoningPayloadModel,
  isResponsesAPIModel,
  parseOpenAIModelId,
  supportsGPTResponsesReasoningEffortNone,
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

  it('should parse GPT-6 ids, which carry a codename instead of a minor version', () => {
    expect(parseOpenAIModelId('gpt-6-astra')).toEqual({
      family: 'gpt',
      majorVersion: 6,
      modifiers: ['astra'],
      normalizedModelId: 'gpt-6-astra',
      source: 'openai',
    });
  });

  it('should not read Azure legacy GPT-3.5 deployment names as major version 35', () => {
    expect(parseOpenAIModelId('gpt-35-turbo')).toBeUndefined();
    expect(parseOpenAIModelId('gpt-35-turbo-16k')).toBeUndefined();
  });

  it('should return undefined for non-GPT ids', () => {
    expect(parseOpenAIModelId('claude-opus-4-1')).toBeUndefined();
  });
});

describe('isGPTResponsesModel', () => {
  it('should preserve current base GPT-5 chat-completions models', () => {
    expect(isGPTResponsesModel('gpt-5')).toBe(false);
    expect(isGPTResponsesModel('gpt-5-chat-latest')).toBe(false);
    expect(isGPTResponsesModel('gpt-5.2-chat-latest')).toBe(false);
    expect(isGPTResponsesModel('gpt-5.3-chat-latest')).toBe(false);
    expect(isResponsesAPIModel('gpt-5.2-chat-latest')).toBe(false);
  });

  it('should match existing GPT-5 Responses models', () => {
    expect(isGPTResponsesModel('gpt-5-mini')).toBe(true);
    expect(isGPTResponsesModel('gpt-5-mini-2025-08-07')).toBe(true);
    expect(isGPTResponsesModel('gpt-5-foo-mini')).toBe(false);
    expect(isGPTResponsesModel('gpt-5-pro')).toBe(true);
    expect(isGPTResponsesModel('gpt-5-pro-2025-10-06')).toBe(true);
    expect(isGPTResponsesModel('gpt-5.1-codex-mini')).toBe(true);
    expect(isGPTResponsesModel('gpt-5.2')).toBe(true);
    expect(isGPTResponsesModel('gpt-5.4-mini')).toBe(true);
    expect(isGPTResponsesModel('gpt-5.5-pro')).toBe(true);
  });

  it('should match the GPT-5.6 family without allowlist entries', () => {
    expect(isGPTResponsesModel('gpt-5.6')).toBe(true);
    expect(isGPTResponsesModel('gpt-5.6-sol')).toBe(true);
    expect(isGPTResponsesModel('gpt-5.6-terra')).toBe(true);
    expect(isGPTResponsesModel('gpt-5.6-luna')).toBe(true);
  });

  it('should match Codex-prefixed GPT-5.6 models', () => {
    expect(isGPTResponsesModel('codex/gpt-5.6-luna')).toBe(true);
    expect(isResponsesAPIModel('codex/gpt-5.6-luna')).toBe(true);
  });

  it('should not force OpenRouter GPT slugs into the built-in Responses API rules', () => {
    expect(isGPTResponsesModel('openai/gpt-5.6-terra')).toBe(false);
    expect(isResponsesAPIModel('openai/gpt-5.6-terra')).toBe(false);
  });

  it('should match the GPT-6 family, which has no minor version and is Responses-only', () => {
    expect(isGPTResponsesModel('gpt-6')).toBe(true);
    expect(isGPTResponsesModel('gpt-6-astra')).toBe(true);
    expect(isResponsesAPIModel('gpt-6-astra')).toBe(true);
    expect(isGPTResponsesModel('codex/gpt-6-astra')).toBe(true);
  });

  it('should keep GPT-6 chat variants and OpenRouter slugs off the Responses endpoint', () => {
    expect(isGPTResponsesModel('gpt-6-chat-latest')).toBe(false);
    expect(isGPTResponsesModel('openai/gpt-6-astra')).toBe(false);
  });

  it('should not match pre-reasoning-era or non-GPT ids', () => {
    expect(isGPTResponsesModel('gpt-4o')).toBe(false);
    expect(isGPTResponsesModel('o3-pro')).toBe(false);
    // Azure's legacy GPT-3.5 deployment name must stay on chat.completions.
    expect(isGPTResponsesModel('gpt-35-turbo-16k')).toBe(false);
    expect(isResponsesAPIModel('gpt-35-turbo-16k')).toBe(false);
  });
});

describe('isGPTProResponsesModel', () => {
  it('should match GPT-5 pro variants', () => {
    expect(isGPTProResponsesModel('gpt-5-pro')).toBe(true);
    expect(isGPTProResponsesModel('gpt-5.5-pro')).toBe(true);
  });

  it('should not match non-pro GPT-5 variants', () => {
    expect(isGPTProResponsesModel('gpt-6-astra')).toBe(false);
    expect(isGPTProResponsesModel('gpt-5.6')).toBe(false);
    expect(isGPTProResponsesModel('gpt-5.6-sol')).toBe(false);
    expect(isGPTProResponsesModel('gpt-5.6-terra')).toBe(false);
    expect(isGPTProResponsesModel('gpt-5.6-luna')).toBe(false);
    expect(isGPTProResponsesModel('openai/gpt-5.5-pro')).toBe(false);
  });
});

describe('supportsGPTResponsesReasoningEffortNone', () => {
  it('should support none reasoning effort for non-pro GPT-5 minor models', () => {
    expect(supportsGPTResponsesReasoningEffortNone('gpt-5.6')).toBe(true);
    expect(supportsGPTResponsesReasoningEffortNone('gpt-5.6-sol')).toBe(true);
    expect(supportsGPTResponsesReasoningEffortNone('gpt-5.6-terra')).toBe(true);
    expect(supportsGPTResponsesReasoningEffortNone('gpt-5.6-luna')).toBe(true);
  });

  it('should not support none reasoning effort on GPT-6, which removed it', () => {
    expect(supportsGPTResponsesReasoningEffortNone('gpt-6-astra')).toBe(false);
  });

  it('should preserve unsupported cases', () => {
    expect(supportsGPTResponsesReasoningEffortNone('gpt-5')).toBe(false);
    expect(supportsGPTResponsesReasoningEffortNone('gpt-5.5-pro')).toBe(false);
    expect(supportsGPTResponsesReasoningEffortNone('openai/gpt-5.6')).toBe(false);
    expect(supportsGPTResponsesReasoningEffortNone('gpt-4o')).toBe(false);
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
    expect(isOpenAIReasoningPayloadModel('gpt-6-astra')).toBe(true);
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
    expect(supportsOpenAIServiceTierFlex('gpt-6-astra')).toBe(true);
    expect(supportsOpenAIServiceTierFlex('openai/gpt-5.6-terra')).toBe(true);
    expect(supportsOpenAIServiceTierFlex('o3-pro')).toBe(true);
    expect(supportsOpenAIServiceTierFlex('o4-mini')).toBe(true);
  });

  it('should preserve unsupported flex tier cases', () => {
    expect(supportsOpenAIServiceTierFlex('o3-mini')).toBe(false);
    expect(supportsOpenAIServiceTierFlex('gpt-4o')).toBe(false);
  });
});

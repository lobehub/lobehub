import { type LobeDefaultAiModelListItem } from 'model-bank';
import { describe, expect, it } from 'vitest';

import { type EnabledProviderWithModels } from '@/types/aiProvider';

import { resolveEnableTargetProviderId, resolveStaleModelState } from './resolveStaleModelState';

const enabledList = [
  {
    children: [{ abilities: {}, displayName: 'Claude Opus 4.6', id: 'claude-opus-4-6' }],
    id: 'lobehub',
    name: 'LobeHub',
    source: 'builtin',
  },
] as unknown as EnabledProviderWithModels[];

const builtinAiModelList = [
  {
    abilities: {},
    displayName: 'GPT-5.4 nano',
    enabled: false,
    id: 'gpt-5.4-nano',
    providerId: 'lobehub',
    type: 'chat',
  },
] as unknown as LobeDefaultAiModelListItem[];

const context = { builtinAiModelList, enabledList, modelType: 'chat' as const };

describe('resolveStaleModelState', () => {
  it('returns undefined for a value present in the enabled list', () => {
    expect(
      resolveStaleModelState({ model: 'claude-opus-4-6', provider: 'lobehub' }, context),
    ).toBeUndefined();
  });

  it('returns undefined when there is no value', () => {
    expect(resolveStaleModelState(undefined, context)).toBeUndefined();
  });

  it('resolves a disabled builtin model as notEnabled with its metadata', () => {
    const state = resolveStaleModelState({ model: 'gpt-5.4-nano', provider: 'lobehub' }, context);

    expect(state?.status).toBe('notEnabled');
    expect(state?.meta?.displayName).toBe('GPT-5.4 nano');
  });

  it('falls back to an id-only match when the provider does not match', () => {
    const state = resolveStaleModelState({ model: 'gpt-5.4-nano', provider: 'openai' }, context);

    expect(state?.status).toBe('notEnabled');
    expect(state?.meta?.displayName).toBe('GPT-5.4 nano');
  });

  it('resolves an unknown model id as removed', () => {
    const state = resolveStaleModelState({ model: 'gpt-4o-mini', provider: 'openai' }, context);

    expect(state?.status).toBe('removed');
    expect(state?.meta).toBeUndefined();
  });

  it('does not treat a same-id model under another enabled provider as enabled', () => {
    const state = resolveStaleModelState(
      { model: 'claude-opus-4-6', provider: 'bedrock' },
      context,
    );

    expect(state?.status).toBe('removed');
  });

  it('ignores builtin models of a different type', () => {
    const state = resolveStaleModelState(
      { model: 'gpt-5.4-nano', provider: 'lobehub' },
      { ...context, modelType: 'embedding' },
    );

    expect(state?.status).toBe('removed');
  });

  describe('resolveEnableTargetProviderId', () => {
    it('prefers the persisted provider when it has enabled models of this type', () => {
      expect(
        resolveEnableTargetProviderId(
          { model: 'gpt-5.4-nano', provider: 'lobehub' },
          { enabledList, metaProviderId: 'openai' },
        ),
      ).toBe('lobehub');
    });

    it('prefers the persisted provider when it is enabled without models of this type', () => {
      expect(
        resolveEnableTargetProviderId(
          { model: 'gpt-5.4-nano', provider: 'lobehub' },
          {
            enabledAiProviders: [{ id: 'lobehub' }],
            enabledList: [],
            metaProviderId: 'openai',
          },
        ),
      ).toBe('lobehub');
    });

    it('falls back to the builtin provider when the persisted provider is unknown', () => {
      expect(
        resolveEnableTargetProviderId(
          { model: 'gpt-5.4-nano', provider: 'legacy-provider' },
          { enabledAiProviders: [{ id: 'lobehub' }], enabledList, metaProviderId: 'openai' },
        ),
      ).toBe('openai');
    });

    it('falls back to the builtin provider when the value has no provider', () => {
      expect(
        resolveEnableTargetProviderId(
          { model: 'gpt-5.4-nano' },
          { enabledList, metaProviderId: 'openai' },
        ),
      ).toBe('openai');
    });
  });

  describe('redirected', () => {
    const modelRedirects = { 'lobehub/gemini-3.1-flash-lite-preview': 'gemini-3.1-flash-lite' };
    const withSuccessorMeta = [
      ...builtinAiModelList,
      {
        abilities: {},
        displayName: 'Gemini 3.1 Flash Lite',
        id: 'gemini-3.1-flash-lite',
        providerId: 'lobehub',
        type: 'chat',
      },
    ] as unknown as LobeDefaultAiModelListItem[];

    it('resolves a redirect-mapped id as redirected with successor metadata', () => {
      const state = resolveStaleModelState(
        { model: 'gemini-3.1-flash-lite-preview', provider: 'lobehub' },
        { ...context, builtinAiModelList: withSuccessorMeta, modelRedirects },
      );

      expect(state?.status).toBe('redirected');
      expect(state?.successorId).toBe('gemini-3.1-flash-lite');
      expect(state?.successor?.displayName).toBe('Gemini 3.1 Flash Lite');
    });

    it('keeps successorId even when the successor has no builtin metadata', () => {
      const state = resolveStaleModelState(
        { model: 'gemini-3.1-flash-lite-preview', provider: 'lobehub' },
        { ...context, modelRedirects },
      );

      expect(state?.status).toBe('redirected');
      expect(state?.successorId).toBe('gemini-3.1-flash-lite');
      expect(state?.successor).toBeUndefined();
    });

    it('prefers the notEnabled state when the id still exists in the builtin bank', () => {
      const state = resolveStaleModelState(
        { model: 'gpt-5.4-nano', provider: 'lobehub' },
        { ...context, modelRedirects: { 'lobehub/gpt-5.4-nano': 'gpt-5.5-nano' } },
      );

      expect(state?.status).toBe('notEnabled');
    });

    it('does not treat a same-named model under an unrelated provider as redirected', () => {
      const state = resolveStaleModelState(
        { model: 'gemini-3.1-flash-lite-preview', provider: 'openai' },
        { ...context, modelRedirects },
      );

      expect(state?.status).toBe('removed');
    });

    it('falls through to removed when the id is not in the redirect map', () => {
      const state = resolveStaleModelState(
        { model: 'gpt-4o-mini', provider: 'openai' },
        { ...context, modelRedirects },
      );

      expect(state?.status).toBe('removed');
    });
  });
});

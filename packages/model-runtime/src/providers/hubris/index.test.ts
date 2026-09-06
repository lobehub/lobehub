// @vitest-environment node
import { ModelProvider } from 'model-bank';
import type { Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { testProvider } from '../../providerTestUtils';
import * as modelParseModule from '../../utils/modelParse';
import { LobeHubrisAI, params } from './index';

const loadModelsMock = vi.hoisted(() => vi.fn().mockResolvedValue([]));

vi.mock('@lobechat/business-model-bank/model-config', () => ({
  loadModels: loadModelsMock,
}));

vi.mock('../../utils/modelParse');

testProvider({
  Runtime: LobeHubrisAI,
  chatDebugEnv: 'DEBUG_HUBRIS_CHAT_COMPLETION',
  chatModel: 'anthropic/claude-sonnet-5',
  defaultBaseURL: 'https://api.hubris.pw/v1',
  provider: ModelProvider.Hubris,
  test: {
    skipAPICall: true,
  },
});

describe('LobeHubrisAI - custom features', () => {
  let mockProcessMultiProviderModelList: Mock;

  beforeEach(() => {
    mockProcessMultiProviderModelList = vi.mocked(modelParseModule.processMultiProviderModelList);
    mockProcessMultiProviderModelList.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('handlePayload', () => {
    it('maps reasoning_effort to reasoning.effort', () => {
      const result = params.chatCompletion?.handlePayload?.({
        messages: [],
        model: 'anthropic/claude-sonnet-5',
        reasoning_effort: 'high',
      } as any) as any;

      expect(result.reasoning).toEqual({ effort: 'high' });
      expect(result.reasoning_effort).toBeUndefined();
    });

    it('maps thinking.budget_tokens to reasoning.max_tokens', () => {
      const result = params.chatCompletion?.handlePayload?.({
        messages: [],
        model: 'anthropic/claude-sonnet-5',
        thinking: { budget_tokens: 2048, type: 'enabled' },
      } as any) as any;

      expect(result.reasoning).toEqual({ max_tokens: 2048 });
      expect(result.thinking).toBeUndefined();
    });

    it('turns reasoning off when thinking is disabled', () => {
      const result = params.chatCompletion?.handlePayload?.({
        messages: [],
        model: 'anthropic/claude-sonnet-5',
        thinking: { budget_tokens: 1024, type: 'disabled' },
      } as any) as any;

      expect(result.reasoning).toEqual({ enabled: false });
    });

    it('omits reasoning when the payload asks for none', () => {
      const result = params.chatCompletion?.handlePayload?.({
        messages: [],
        model: 'anthropic/claude-sonnet-5',
        temperature: 0.7,
      } as any) as any;

      expect(result.reasoning).toBeUndefined();
      expect(result.temperature).toBe(0.7);
      expect(result.stream).toBe(true);
    });

    it('keeps an explicit stream: false', () => {
      const result = params.chatCompletion?.handlePayload?.({
        messages: [],
        model: 'anthropic/claude-sonnet-5',
        stream: false,
      } as any) as any;

      expect(result.stream).toBe(false);
    });
  });

  describe('models', () => {
    const listing = (data: any[]) =>
      ({ models: { list: vi.fn().mockResolvedValue({ data }) } }) as any;

    it('maps catalogue metadata onto model cards', async () => {
      await params.models!({
        client: listing([
          {
            context_window: 1_000_000,
            created: 1_788_699_151,
            description: 'Sonnet-class model.',
            display_name: 'Anthropic: Claude Sonnet 5',
            id: 'anthropic/claude-sonnet-5',
            input_modalities: ['text', 'image', 'file'],
            object: 'model',
            output_modalities: ['text'],
            owned_by: 'anthropic',
            supported_parameters: ['reasoning', 'tools'],
          },
        ]),
      } as any);

      expect(mockProcessMultiProviderModelList).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            contextWindowTokens: 1_000_000,
            displayName: 'Claude Sonnet 5',
            functionCall: true,
            id: 'anthropic/claude-sonnet-5',
            reasoning: true,
            releasedAt: '2026-09-06',
            video: false,
            vision: true,
          }),
        ],
        'hubris',
      );
    });

    it('leaves capabilities undefined when the catalogue omits the fields', async () => {
      await params.models!({
        client: listing([
          { id: 'openai/gpt-6-astra', object: 'model', owned_by: 'openai' },
        ]),
      } as any);

      expect(mockProcessMultiProviderModelList).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            displayName: undefined,
            functionCall: undefined,
            id: 'openai/gpt-6-astra',
            reasoning: undefined,
            releasedAt: undefined,
            video: undefined,
            vision: undefined,
          }),
        ],
        'hubris',
      );
    });

    it('handles an empty catalogue', async () => {
      const models = await params.models!({ client: listing([]) } as any);

      expect(models).toEqual([]);
    });
  });
});

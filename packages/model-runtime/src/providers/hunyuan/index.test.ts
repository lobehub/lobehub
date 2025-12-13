// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LobeOpenAICompatibleRuntime } from '../../core/BaseAI';
import { testProvider } from '../../providerTestUtils';
import { LobeHunyuanAI, params } from './index';

testProvider({
  Runtime: LobeHunyuanAI,
  provider: ModelProvider.Hunyuan,
  defaultBaseURL: 'https://api.hunyuan.cloud.tencent.com/v1',
  chatDebugEnv: 'DEBUG_HUNYUAN_CHAT_COMPLETION',
  chatModel: 'hunyuan-lite',
});

// Mock the console.error to avoid polluting test output
vi.spyOn(console, 'error').mockImplementation(() => {});

let instance: LobeOpenAICompatibleRuntime;

beforeEach(() => {
  instance = new LobeHunyuanAI({ apiKey: 'test' });

  // 使用 vi.spyOn 来模拟 chat.completions.create 方法
  vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue(
    new ReadableStream() as any,
  );
});

describe('LobeHunyuanAI', () => {
  describe('chat', () => {
    it('should with search citations', async () => {
      const data = [
        {
          id: '939fbdb8dbb9b4c5944cbbe687c977c2',
          object: 'chat.completion.chunk',
          created: 1741000456,
          model: 'hunyuan-turbo',
          system_fingerprint: '',
          choices: [
            {
              index: 0,
              delta: { role: 'assistant', content: '为您' },
              finish_reason: null,
            },
          ],
          note: '以上内容为AI生成，不代表开发者立场，请勿删除或修改本标记',
          search_info: {
            search_results: [
              {
                index: 1,
                title: '公务员考试时政热点【2025年3月3日】_公务员考试网_华图教育',
                url: 'http://www.huatu.com/2025/0303/2803685.html',
                icon: 'https://hunyuan-img-1251316161.cos.ap-guangzhou.myqcloud.com/%2Fpublic/img/63ce96deffe0119827f12deaa5ffe7ef.jpg',
                text: '华图教育官网',
              },
              {
                index: 2,
                title: '外交部新闻（2025年3月3日）',
                url: 'https://view.inews.qq.com/a/20250303A02NLC00?scene=qqsearch',
                icon: 'https://hunyuan-img-1251316161.cos.ap-guangzhou.myqcloud.com/%2Fpublic/img/00ce40298870d1accb7920d641152722.jpg',
                text: '腾讯网',
              },
            ],
          },
        },
        {
          id: '939fbdb8dbb9b4c5944cbbe687c977c2',
          object: 'chat.completion.chunk',
          created: 1741000456,
          model: 'hunyuan-turbo',
          system_fingerprint: '',
          choices: [
            {
              index: 0,
              delta: { role: 'assistant', content: '找到' },
              finish_reason: null,
            },
          ],
          note: '以上内容为AI生成，不代表开发者立场，请勿删除或修改本标记',
          search_info: {
            search_results: [
              {
                index: 1,
                title: '公务员考试时政热点【2025年3月3日】_公务员考试网_华图教育',
                url: 'http://www.huatu.com/2025/0303/2803685.html',
                icon: 'https://hunyuan-img-1251316161.cos.ap-guangzhou.myqcloud.com/%2Fpublic/img/63ce96deffe0119827f12deaa5ffe7ef.jpg',
                text: '华图教育官网',
              },
              {
                index: 2,
                title: '外交部新闻（2025年3月3日）',
                url: 'https://view.inews.qq.com/a/20250303A02NLC00?scene=qqsearch',
                icon: 'https://hunyuan-img-1251316161.cos.ap-guangzhou.myqcloud.com/%2Fpublic/img/00ce40298870d1accb7920d641152722.jpg',
                text: '腾讯网',
              },
            ],
          },
        },
      ];

      const mockStream = new ReadableStream({
        start(controller) {
          data.forEach((chunk) => {
            controller.enqueue(chunk);
          });

          controller.close();
        },
      });

      vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue(mockStream as any);

      const result = await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'mistralai/mistral-7b-instruct:free',
        temperature: 0,
      });

      const decoder = new TextDecoder();
      const reader = result.body!.getReader();
      const stream: string[] = [];

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        stream.push(decoder.decode(value));
      }

      expect(stream).toEqual(
        [
          'id: 939fbdb8dbb9b4c5944cbbe687c977c2',
          'event: grounding',
          'data: {"citations":[{"title":"公务员考试时政热点【2025年3月3日】_公务员考试网_华图教育","url":"http://www.huatu.com/2025/0303/2803685.html"},{"title":"外交部新闻（2025年3月3日）","url":"https://view.inews.qq.com/a/20250303A02NLC00?scene=qqsearch"}]}\n',
          'id: 939fbdb8dbb9b4c5944cbbe687c977c2',
          'event: text',
          'data: "为您"\n',
          'id: 939fbdb8dbb9b4c5944cbbe687c977c2',
          'event: text',
          'data: "找到"\n',
        ].map((line) => `${line}\n`),
      );

      expect((await reader.read()).done).toBe(true);
    });
  });
});

describe('LobeHunyuanAI - custom features', () => {
  describe('Debug Configuration', () => {
    it('should disable debug by default', () => {
      delete process.env.DEBUG_HUNYUAN_CHAT_COMPLETION;
      const result = params.debug.chatCompletion();
      expect(result).toBe(false);
    });

    it('should enable debug when env is set', () => {
      process.env.DEBUG_HUNYUAN_CHAT_COMPLETION = '1';
      const result = params.debug.chatCompletion();
      expect(result).toBe(true);
      delete process.env.DEBUG_HUNYUAN_CHAT_COMPLETION;
    });
  });

  describe('handlePayload', () => {
    const handlePayload = params.chatCompletion.handlePayload!;

    it('should remove frequency_penalty and presence_penalty from payload', () => {
      const payload = {
        model: 'hunyuan-lite',
        messages: [{ role: 'user', content: 'test' }],
        frequency_penalty: 0.5,
        presence_penalty: 0.3,
        temperature: 0.7,
      } as any;

      const result = handlePayload(payload);

      expect(result.frequency_penalty).toBeUndefined();
      expect(result.presence_penalty).toBeUndefined();
      expect(result.model).toBe('hunyuan-lite');
      expect(result.temperature).toBe(0.7);
      expect(result.stream).toBe(true);
    });

    it('should add search fields when enabledSearch is true', () => {
      const payload = {
        model: 'hunyuan-turbo',
        messages: [{ role: 'user', content: 'test' }],
        enabledSearch: true,
      } as any;

      const result = handlePayload(payload);

      expect(result.citation).toBe(true);
      expect(result.enable_enhancement).toBe(true);
      expect(result.search_info).toBe(true);
      expect(result.enabledSearch).toBeUndefined();
    });

    it('should respect HUNYUAN_ENABLE_SPEED_SEARCH env when search is enabled', () => {
      process.env.HUNYUAN_ENABLE_SPEED_SEARCH = '1';

      const payload = {
        model: 'hunyuan-turbo',
        messages: [{ role: 'user', content: 'test' }],
        enabledSearch: true,
      } as any;

      const result = handlePayload(payload);

      expect(result.enable_speed_search).toBe(true);

      delete process.env.HUNYUAN_ENABLE_SPEED_SEARCH;
    });

    it('should not enable speed search by default', () => {
      delete process.env.HUNYUAN_ENABLE_SPEED_SEARCH;

      const payload = {
        model: 'hunyuan-turbo',
        messages: [{ role: 'user', content: 'test' }],
        enabledSearch: true,
      } as any;

      const result = handlePayload(payload);

      expect(result.enable_speed_search).toBe(false);
    });

    it('should not add search fields when enabledSearch is false', () => {
      const payload = {
        model: 'hunyuan-lite',
        messages: [{ role: 'user', content: 'test' }],
        enabledSearch: false,
      } as any;

      const result = handlePayload(payload);

      expect(result.citation).toBeUndefined();
      expect(result.enable_enhancement).toBeUndefined();
      expect(result.search_info).toBeUndefined();
      expect(result.enable_speed_search).toBeUndefined();
    });

    it('should enable thinking for hunyuan-a13b when thinking.type is enabled', () => {
      const payload = {
        model: 'hunyuan-a13b',
        messages: [{ role: 'user', content: 'test' }],
        thinking: { type: 'enabled' },
      } as any;

      const result = handlePayload(payload);

      expect(result.enable_thinking).toBe(true);
      expect(result.thinking).toBeUndefined();
    });

    it('should disable thinking for hunyuan-a13b when thinking.type is disabled', () => {
      const payload = {
        model: 'hunyuan-a13b',
        messages: [{ role: 'user', content: 'test' }],
        thinking: { type: 'disabled' },
      } as any;

      const result = handlePayload(payload);

      expect(result.enable_thinking).toBe(false);
    });

    it('should set thinking to undefined for hunyuan-a13b when thinking.type is undefined', () => {
      const payload = {
        model: 'hunyuan-a13b',
        messages: [{ role: 'user', content: 'test' }],
        thinking: { type: undefined },
      } as any;

      const result = handlePayload(payload);

      expect(result.enable_thinking).toBeUndefined();
    });

    it('should not add enable_thinking for non-hunyuan-a13b models', () => {
      const payload = {
        model: 'hunyuan-lite',
        messages: [{ role: 'user', content: 'test' }],
        thinking: { type: 'enabled' },
      } as any;

      const result = handlePayload(payload);

      expect(result.enable_thinking).toBeUndefined();
    });

    it('should handle combined enabledSearch and thinking for hunyuan-a13b', () => {
      process.env.HUNYUAN_ENABLE_SPEED_SEARCH = '1';

      const payload = {
        model: 'hunyuan-a13b',
        messages: [{ role: 'user', content: 'test' }],
        enabledSearch: true,
        thinking: { type: 'enabled' },
        temperature: 0.5,
      } as any;

      const result = handlePayload(payload);

      expect(result.citation).toBe(true);
      expect(result.enable_enhancement).toBe(true);
      expect(result.search_info).toBe(true);
      expect(result.enable_speed_search).toBe(true);
      expect(result.enable_thinking).toBe(true);
      expect(result.temperature).toBe(0.5);
      expect(result.stream).toBe(true);

      delete process.env.HUNYUAN_ENABLE_SPEED_SEARCH;
    });
  });

  describe('models', () => {
    const mockClient = {
      models: {
        list: vi.fn(),
      },
    } as any;

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should fetch and process models with function call detection', async () => {
      mockClient.models.list.mockResolvedValue({
        data: [
          { id: 'hunyuan-functioncall' },
          { id: 'hunyuan-turbo' },
          { id: 'hunyuan-pro' },
          { id: 'hunyuan-lite' },
        ],
      });

      const models = await params.models({ client: mockClient });

      expect(mockClient.models.list).toHaveBeenCalledTimes(1);
      expect(models).toHaveLength(4);

      const functionCallModel = models.find((m) => m.id === 'hunyuan-functioncall');
      expect(functionCallModel?.functionCall).toBe(true);

      const turboModel = models.find((m) => m.id === 'hunyuan-turbo');
      expect(turboModel?.functionCall).toBe(true);

      const proModel = models.find((m) => m.id === 'hunyuan-pro');
      expect(proModel?.functionCall).toBe(true);

      const liteModel = models.find((m) => m.id === 'hunyuan-lite');
      expect(liteModel?.functionCall).toBe(false);
    });

    it('should not enable function call for vision models even with keywords', async () => {
      mockClient.models.list.mockResolvedValue({
        data: [{ id: 'hunyuan-turbo-vision' }, { id: 'hunyuan-functioncall-vision' }],
      });

      const models = await params.models({ client: mockClient });

      expect(models).toHaveLength(2);

      const visionModel1 = models.find((m) => m.id === 'hunyuan-turbo-vision');
      expect(visionModel1?.functionCall).toBe(false);
      expect(visionModel1?.vision).toBe(true);

      const visionModel2 = models.find((m) => m.id === 'hunyuan-functioncall-vision');
      expect(visionModel2?.functionCall).toBe(false);
      expect(visionModel2?.vision).toBe(true);
    });

    it('should detect reasoning models', async () => {
      mockClient.models.list.mockResolvedValue({
        data: [{ id: 'hunyuan-t1' }, { id: 'hunyuan-lite' }],
      });

      const models = await params.models({ client: mockClient });

      expect(models).toHaveLength(2);

      const reasoningModel = models.find((m) => m.id === 'hunyuan-t1');
      expect(reasoningModel?.reasoning).toBe(true);

      const normalModel = models.find((m) => m.id === 'hunyuan-lite');
      expect(normalModel?.reasoning).toBe(false);
    });

    it('should detect vision models', async () => {
      mockClient.models.list.mockResolvedValue({
        data: [{ id: 'hunyuan-vision' }, { id: 'hunyuan-lite-vision' }, { id: 'hunyuan-lite' }],
      });

      const models = await params.models({ client: mockClient });

      expect(models).toHaveLength(3);

      const visionModel1 = models.find((m) => m.id === 'hunyuan-vision');
      expect(visionModel1?.vision).toBe(true);

      const visionModel2 = models.find((m) => m.id === 'hunyuan-lite-vision');
      expect(visionModel2?.vision).toBe(true);

      const normalModel = models.find((m) => m.id === 'hunyuan-lite');
      expect(normalModel?.vision).toBe(false);
    });

    it('should merge with LOBE_DEFAULT_MODEL_LIST for known models', async () => {
      mockClient.models.list.mockResolvedValue({
        data: [{ id: 'hunyuan-lite' }],
      });

      const models = await params.models({ client: mockClient });

      expect(models).toHaveLength(1);

      const model = models[0];
      // LOBE_DEFAULT_MODEL_LIST should provide these values
      expect(model.id).toBe('hunyuan-lite');
      expect(model.enabled).toBeDefined();
    });

    it('should handle unknown models with defaults', async () => {
      mockClient.models.list.mockResolvedValue({
        data: [{ id: 'hunyuan-unknown-model' }],
      });

      const models = await params.models({ client: mockClient });

      expect(models).toHaveLength(1);

      const model = models[0];
      expect(model.id).toBe('hunyuan-unknown-model');
      expect(model.enabled).toBe(false);
      expect(model.contextWindowTokens).toBeUndefined();
      expect(model.displayName).toBeUndefined();
    });

    it('should handle case-insensitive model matching', async () => {
      mockClient.models.list.mockResolvedValue({
        data: [{ id: 'HUNYUAN-LITE' }],
      });

      const models = await params.models({ client: mockClient });

      expect(models).toHaveLength(1);
      expect(models[0].id).toBe('HUNYUAN-LITE');
    });

    it('should combine multiple abilities correctly', async () => {
      mockClient.models.list.mockResolvedValue({
        data: [
          { id: 'hunyuan-turbo' },
          { id: 'hunyuan-t1' },
          { id: 'hunyuan-vision' },
          { id: 'hunyuan-turbo-vision' },
        ],
      });

      const models = await params.models({ client: mockClient });

      expect(models).toHaveLength(4);

      const turboModel = models.find((m) => m.id === 'hunyuan-turbo');
      expect(turboModel?.functionCall).toBe(true);
      expect(turboModel?.reasoning).toBe(false);
      expect(turboModel?.vision).toBe(false);

      const reasoningModel = models.find((m) => m.id === 'hunyuan-t1');
      expect(reasoningModel?.functionCall).toBe(false);
      expect(reasoningModel?.reasoning).toBe(true);
      expect(reasoningModel?.vision).toBe(false);

      const visionModel = models.find((m) => m.id === 'hunyuan-vision');
      expect(visionModel?.functionCall).toBe(false);
      expect(visionModel?.reasoning).toBe(false);
      expect(visionModel?.vision).toBe(true);

      const turboVisionModel = models.find((m) => m.id === 'hunyuan-turbo-vision');
      expect(turboVisionModel?.functionCall).toBe(false);
      expect(turboVisionModel?.reasoning).toBe(false);
      expect(turboVisionModel?.vision).toBe(true);
    });

    it('should handle empty model list', async () => {
      mockClient.models.list.mockResolvedValue({
        data: [],
      });

      const models = await params.models({ client: mockClient });

      expect(models).toHaveLength(0);
    });

    it('should filter out falsy values', async () => {
      mockClient.models.list.mockResolvedValue({
        data: [{ id: 'hunyuan-lite' }, null, undefined],
      });

      const models = await params.models({ client: mockClient });

      // Only valid models should be included
      expect(models.length).toBeGreaterThan(0);
      expect(models.every((m) => m !== null && m !== undefined)).toBe(true);
    });
  });
});

// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LobeOpenAICompatibleRuntime } from '../../core/BaseAI';
import { testProvider } from '../../providerTestUtils';
import { LobePerplexityAI } from './index';

testProvider({
  Runtime: LobePerplexityAI,
  provider: ModelProvider.Perplexity,
  defaultBaseURL: 'https://api.perplexity.ai',
  chatDebugEnv: 'DEBUG_PERPLEXITY_CHAT_COMPLETION',
  chatModel: 'sonar',
});

// Mock the console.error to avoid polluting test output
vi.spyOn(console, 'error').mockImplementation(() => {});

let instance: LobeOpenAICompatibleRuntime;

beforeEach(() => {
  instance = new LobePerplexityAI({ apiKey: 'test' });

  // 使用 vi.spyOn 来模拟 chat.completions.create 方法
  vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue(
    new ReadableStream() as any,
  );
});

describe('LobePerplexityAI', () => {
  describe('chat', () => {
    it('should call chat method with temperature', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'text-davinci-003',
        temperature: 1.5,
      });

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.any(Array),
          model: 'text-davinci-003',
          temperature: 1.5,
        }),
        expect.any(Object),
      );
    });

    it('should be undefined when temperature >= 2', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'text-davinci-003',
        temperature: 2,
      });

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.any(Array),
          model: 'text-davinci-003',
          temperature: undefined,
        }),
        expect.any(Object),
      );
    });

    it('should with search citations', async () => {
      const data = [
        {
          id: '506d64fb-e7f2-4d94-b80f-158369e9446d',
          model: 'sonar-pro',
          created: 1739896615,
          object: 'chat.completion.chunk',
          choices: [
            {
              finish_reason: null,
              index: 0,
              delta: {
                refusal: null,
                content: '<think>',
                role: 'assistant',
                function_call: null,
                tool_calls: null,
                audio: null,
              },
              logprobs: null,
            },
          ],
          stream_options: null,
          citations: null,
        },
        {
          id: '506d64fb-e7f2-4d94-b80f-158369e9446d',
          model: 'sonar-pro',
          created: 1739896615,
          usage: {
            prompt_tokens: 4,
            completion_tokens: 3,
            total_tokens: 7,
            citation_tokens: 2217,
            num_search_queries: 1,
          },
          citations: [
            'https://www.weather.com.cn/weather/101210101.shtml',
            'https://tianqi.moji.com/weather/china/zhejiang/hangzhou',
            'https://weather.cma.cn/web/weather/58457.html',
            'https://tianqi.so.com/weather/101210101',
            'https://www.accuweather.com/zh/cn/hangzhou/106832/weather-forecast/106832',
            'https://www.hzqx.com',
            'https://www.hzqx.com/pc/hztq/',
          ],
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              finish_reason: null,
              message: {
                role: 'assistant',
                content: '杭州今',
              },
              delta: {
                role: 'assist',
                content: '杭州今',
              },
            },
          ],
        },
        {
          id: '506d64fb-e7f2-4d94-b80f-158369e9446d',
          model: 'sonar-pro',
          created: 1739896615,
          usage: {
            prompt_tokens: 4,
            completion_tokens: 9,
            total_tokens: 13,
            citation_tokens: 2217,
            num_search_queries: 1,
          },
          citations: [
            'https://www.weather.com.cn/weather/101210101.shtml',
            'https://tianqi.moji.com/weather/china/zhejiang/hangzhou',
            'https://weather.cma.cn/web/weather/58457.html',
            'https://tianqi.so.com/weather/101210101',
            'https://www.accuweather.com/zh/cn/hangzhou/106832/weather-forecast/106832',
            'https://www.hzqx.com',
            'https://www.hzqx.com/pc/hztq/',
          ],
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              finish_reason: null,
              message: {
                role: 'assistant',
                content: '杭州今天和未来几天的',
              },
              delta: {
                role: 'assistant',
                content: '天和未来几天的',
              },
            },
          ],
        },
        {
          id: '506d64fb-e7f2-4d94-b80f-158369e9446d',
          model: 'sonar-reasoning-pro',
          created: 1741250924,
          usage: {
            prompt_tokens: 2,
            completion_tokens: 685,
            total_tokens: 687,
            citation_tokens: 3058,
            num_search_queries: 1,
          },
          citations: [
            'https://www.weather.com.cn/weather/101210101.shtml',
            'https://tianqi.moji.com/weather/china/zhejiang/hangzhou',
            'https://weather.cma.cn/web/weather/58457.html',
            'https://tianqi.so.com/weather/101210101',
            'https://www.accuweather.com/zh/cn/hangzhou/106832/weather-forecast/106832',
            'https://www.hzqx.com',
            'https://www.hzqx.com/pc/hztq/',
          ],
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              finish_reason: 'stop',
              message: {
                role: 'assistant',
                content:
                  '<think>\n好的，我现在要处理用户的我需要确定这个查询的类型。用户显然是在询问当前的天气情况和预报，因此属于天气预报类型。接下来我要查看提供的搜索结果，看看这些来源是否能提供准确的信息。\n\n第一个来源是weather.com.cn的、西北风5~6级等。接着查看第二个结果[2]是中央气象台的详细分时数据，比如7月18日和21日的温度、降水、风速等信息。[3]来自中国气象局的气象预报显示有阴天和多云交替的情况，（如星期三03/05阴温暖但空气质量差。[6][7]则是杭州市气象台的最新天气预报发布情况：后半夜转多云明天白天继续多云的天气。\n\n现在要将这些信息整合起来形成连贯的回答。需要注意是否有矛盾的地方以及按照可信度部或东北部常见四至五级阵风；昼夜温差较大比如最高温可达20多摄氏度最低至10℃左右这样需要提醒注意衣物调整防寒保暖同时也指出空气质量在某些时段可能不佳特别是根据[5]，AccuWeather提示空气质响出行健康的重点要素如空气指标并且保证引用每个相关数据都注明正确的出处编号避免遗漏重要细节同时保持回答简洁明了使用户一目了然.\n</think>\n\n杭州近期以阴到多云天气为主，夜间偶有小雨[1 未来三日预报\n- **今天傍晚至夜间**：局部小雨渐止转阴到多云\\[6\\] [7]\n- **明日（周六）**  \n  - 白天多云为主   \n  - 温度区间16℃~22℃，西北风5~6级 \\[2\\] [3]\n- **后天（周日）**\n\\] [3]\n\n### *注意事项*\n1. **昼夜温差大**：早晚低温多在10°C以下需加外套防风保温；\n2. **空气污染警告** AccuWeather指出当地PM指数超标易引发达呼吸道不适建议尽量减少户外长时间活动时r/china/zjejiang/hangzhou" target="_blank">墨迹实况雷达图</a>获取临近降水动态.',
              },
              delta: { role: 'assistant', content: '' },
            },
          ],
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

      // Slice out speed chunk
      const noSpeedStream = stream.slice(0, -3);

      expect(noSpeedStream).toEqual(
        [
          'id: 506d64fb-e7f2-4d94-b80f-158369e9446d',
          'event: reasoning',
          'data: ""\n',
          'id: 506d64fb-e7f2-4d94-b80f-158369e9446d',
          'event: grounding',
          'data: {"citations":[{"title":"https://www.weather.com.cn/weather/101210101.shtml","url":"https://www.weather.com.cn/weather/101210101.shtml"},{"title":"https://tianqi.moji.com/weather/china/zhejiang/hangzhou","url":"https://tianqi.moji.com/weather/china/zhejiang/hangzhou"},{"title":"https://weather.cma.cn/web/weather/58457.html","url":"https://weather.cma.cn/web/weather/58457.html"},{"title":"https://tianqi.so.com/weather/101210101","url":"https://tianqi.so.com/weather/101210101"},{"title":"https://www.accuweather.com/zh/cn/hangzhou/106832/weather-forecast/106832","url":"https://www.accuweather.com/zh/cn/hangzhou/106832/weather-forecast/106832"},{"title":"https://www.hzqx.com","url":"https://www.hzqx.com"},{"title":"https://www.hzqx.com/pc/hztq/","url":"https://www.hzqx.com/pc/hztq/"}]}\n',
          'id: 506d64fb-e7f2-4d94-b80f-158369e9446d',
          'event: reasoning',
          'data: "杭州今"\n',
          'id: 506d64fb-e7f2-4d94-b80f-158369e9446d',
          'event: reasoning',
          'data: "天和未来几天的"\n',
          'id: 506d64fb-e7f2-4d94-b80f-158369e9446d',
          'event: usage',
          'data: {"inputCitationTokens":3058,"inputTextTokens":2,"outputTextTokens":685,"totalInputTokens":3060,"totalOutputTokens":685,"totalTokens":3745}\n',
        ].map((line) => `${line}\n`),
      );

      expect((await reader.read()).done).toBe(true);
    });
  });
});

import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { resolveParameters } from '../../core/parameterResolver';
import { OpenAIStream } from '../../core/streams/openai';
import { convertIterableToStream } from '../../core/streams/protocol';
import { MODEL_LIST_CONFIGS, processModelList } from '../../utils/modelParse';

export interface ZhipuModelCard {
  description: string;
  modelCode: string;
  modelName: string;
}

export const params = {
  baseURL: 'https://open.bigmodel.cn/api/paas/v4',
  chatCompletion: {
    handlePayload: (payload) => {
      const { enabledSearch, max_tokens, model, temperature, thinking, tools, top_p, ...rest } =
        payload;

      const zhipuTools = enabledSearch
        ? [
            ...(tools || []),
            {
              type: 'web_search',
              web_search: {
                enable: true,
                result_sequence: 'before', // Change search result return sequence to 'before' to minimize OpenAIStream modifications
                search_engine: process.env.ZHIPU_SEARCH_ENGINE || 'search_std', // search_std, search_pro
                search_result: true,
              },
            },
          ]
        : tools;

      // Resolve parameters based on model-specific constraints
      const resolvedParams = resolveParameters(
        { max_tokens, temperature, top_p },
        {
          // max_tokens constraints
          maxTokensRange: model.includes('glm-4v')
            ? { max: 1024 }
            : model === 'glm-zero-preview'
              ? { max: 15_300 }
              : undefined,
          normalizeTemperature: true,
          // glm-4-alltools has stricter temperature and top_p constraints
          ...(model === 'glm-4-alltools' && {
            temperatureRange: { max: 0.99, min: 0.01 },
            topPRange: { max: 0.99, min: 0.01 },
          }),
        },
      );

      return {
        ...rest,
        ...resolvedParams,
        model,
        stream: true,
        thinking: thinking ? { type: thinking.type } : undefined,
        tools: zhipuTools,
      } as any;
    },
    handleStream: (stream, { callbacks, inputStartAt }) => {
      const readableStream =
        stream instanceof ReadableStream ? stream : convertIterableToStream(stream);

      // GLM-4.5 series models return index -1 in tool_calls, needs to be fixed before entering OpenAIStream
      // because OpenAIStream internally filters out tool_calls with index < 0 (openai.ts:58-60)
      const preprocessedStream = readableStream.pipeThrough(
        new TransformStream({
          transform(chunk, controller) {
            // Handle raw OpenAI ChatCompletionChunk format
            if (chunk.choices && chunk.choices[0]) {
              const choice = chunk.choices[0];
              if (choice.delta?.tool_calls && Array.isArray(choice.delta.tool_calls)) {
                // Fix negative index, convert -1 to positive index based on array position
                const fixedToolCalls = choice.delta.tool_calls.map(
                  (toolCall: any, globalIndex: number) => ({
                    ...toolCall,
                    index: toolCall.index < 0 ? globalIndex : toolCall.index,
                  }),
                );

                // Create fixed chunk
                const fixedChunk = {
                  ...chunk,
                  choices: [
                    {
                      ...choice,
                      delta: {
                        ...choice.delta,
                        tool_calls: fixedToolCalls,
                      },
                    },
                  ],
                };

                controller.enqueue(fixedChunk);
              } else {
                controller.enqueue(chunk);
              }
            } else {
              controller.enqueue(chunk);
            }
          },
        }),
      );

      return OpenAIStream(preprocessedStream, {
        callbacks,
        inputStartAt,
        payload: {
          provider: 'zhipu',
        },
      });
    },
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_ZHIPU_CHAT_COMPLETION === '1',
  },
  models: async ({ client }) => {
    // ref: https://open.bigmodel.cn/console/modelcenter/square
    const url = 'https://open.bigmodel.cn/api/fine-tuning/model_center/list?pageSize=100&pageNum=1';
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${client.apiKey}`,
        'Bigmodel-Organization': 'lobehub',
        'Bigmodel-Project': 'lobechat',
      },
      method: 'GET',
    });
    const json = await response.json();

    const modelList: ZhipuModelCard[] = json.rows;

    const standardModelList = modelList.map((model) => ({
      description: model.description,
      displayName: model.modelName,
      id: model.modelCode,
    }));
    return processModelList(standardModelList, MODEL_LIST_CONFIGS.zhipu, 'zhipu');
  },
  provider: ModelProvider.ZhiPu,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeZhipuAI = createOpenAICompatibleRuntime(params);

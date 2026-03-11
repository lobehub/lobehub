import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { SparkAIStream, transformSparkResponseToStream } from '../../core/streams';
import type { ChatStreamPayload } from '../../types';

const getBaseURLByModel = (model: string): string => {
  const v1Regex = /^(?:lite|generalv3|pro-128k|generalv3\.5|max-32k|4\.0Ultra)$/i;

  // Legacy models via v1 endpoint
  if (v1Regex.test(model)) {
    return 'https://spark-api-open.xf-yun.com/v1';
  }

  return 'https://spark-api-open.xf-yun.com/v2';
};

export const params = {
  baseURL: 'https://spark-api-open.xf-yun.com/v2',
  chatCompletion: {
    handlePayload: (payload: ChatStreamPayload, options) => {
      const { enabledSearch, thinking, tools, ...rest } = payload;

      const baseURL = getBaseURLByModel(payload.model);
      if (options) options.baseURL = baseURL;

      const sparkTools = enabledSearch
        ? [
            ...(tools || []),
            {
              type: 'web_search',
              web_search: {
                enable: true,
                search_mode: process.env.SPARK_SEARCH_MODE || 'normal', // normal or deep
                /*
              show_ref_label: true,
              */
              },
            },
          ]
        : tools;

      return {
        ...rest,
        thinking: { type: thinking?.type },
        tools: sparkTools,
      } as any;
    },
    handleStream: SparkAIStream,
    handleTransformResponseToStream: transformSparkResponseToStream,
    noUserId: true,
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_SPARK_CHAT_COMPLETION === '1',
  },
  provider: ModelProvider.Spark,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeSparkAI = createOpenAICompatibleRuntime(params);

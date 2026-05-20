import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { SparkAIStream, transformSparkResponseToStream } from '../../core/streams';
import type { ChatStreamPayload } from '../../types';

const getBaseURLByModel = (model: string): string => {
  switch (model) {
    case 'spark-x2-flash': {
      return 'https://spark-api-open.xf-yun.com/agent/v1';
    }

    case 'spark-x2': {
      return 'https://spark-api-open.xf-yun.com/x2';
    }

    case 'spark-x1.5': {
      return 'https://spark-api-open.xf-yun.com/v2';
    }

    default: {
      return 'https://spark-api-open.xf-yun.com/v1';
    }
  }
};

export const params = {
  baseURL: 'https://spark-api-open.xf-yun.com/v1',
  chatCompletion: {
    handlePayload: (payload: ChatStreamPayload, options) => {
      const { deploymentName, enabledSearch, model, thinking, tools, ...rest } = payload;

      const requestModel = deploymentName ?? model;

      const baseURL = getBaseURLByModel(model);
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
        model: requestModel,
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

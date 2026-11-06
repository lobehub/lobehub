import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import type { ASROptions, ASRPayload, ASRResponse } from '../../types';
import { processModelList } from '../../utils/modelParse';

interface GreenPTTranscriptionResponse {
  results?: {
    channels?: Array<{
      alternatives?: Array<{ transcript?: string }>;
    }>;
  };
}

export const params = {
  baseURL: 'https://api.greenpt.ai/v1',
  debug: {
    chatCompletion: () => process.env.DEBUG_GREENPT_CHAT_COMPLETION === '1',
  },
  models: async ({ client }) => {
    const modelsPage = (await client.models.list()) as any;
    const modelList = (Array.isArray(modelsPage?.data) ? modelsPage.data : []).filter(
      ({ id }: { id?: string }) => id && id !== 'green-rerank',
    );

    return processModelList(modelList, {}, ModelProvider.GreenPT);
  },
  provider: ModelProvider.GreenPT,
} satisfies OpenAICompatibleFactoryOptions;

const GreenPTOpenAICompatibleRuntime = createOpenAICompatibleRuntime(params);

export class LobeGreenPTAI extends GreenPTOpenAICompatibleRuntime {
  async transcribe(payload: ASRPayload, options?: ASROptions): Promise<ASRResponse> {
    const url = new URL(`${this.baseURL.replace(/\/+$/, '')}/listen`);
    url.searchParams.set('model', this.getMappedModelId(payload.model));
    if (payload.language) url.searchParams.set('language', payload.language);

    try {
      const response = await fetch(url, {
        body: payload.file,
        headers: {
          'Authorization': `Bearer ${this._options.apiKey}`,
          'Content-Type': payload.file.type || 'application/octet-stream',
          ...options?.headers,
        },
        method: 'POST',
        signal: options?.signal,
      });

      if (!response.ok) {
        const error = new Error(`GreenPT transcription request failed: ${response.status}`);
        Object.assign(error, { status: response.status });
        throw error;
      }

      const data = (await response.json()) as GreenPTTranscriptionResponse;
      const text =
        data.results?.channels
          ?.map((channel) => channel.alternatives?.[0]?.transcript?.trim())
          .filter(Boolean)
          .join('\n') ?? '';

      return { text };
    } catch (error) {
      throw this.handleError(error);
    }
  }
}

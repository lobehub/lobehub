import { ModelProvider } from 'model-bank';

import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { MODEL_LIST_CONFIGS, processModelList } from '../../utils/modelParse';
import {
  handleXAIChatCompletionPayload,
  handleXAIResponsesPayload,
  type XAIModelCard,
} from '../xai';

/**
 * SuperGrok / X Premium subscription access to Grok models.
 *
 * Talks to the exact same OpenAI-compatible `https://api.x.ai/v1` endpoint as
 * the `xai` provider (payload handling is shared), but authenticates with an
 * OAuth access token instead of an API key. The token is refreshed and
 * injected server-side (see `apps/server` oauthDeviceFlow refresh service) —
 * this runtime stays a stateless bearer client, receiving the fresh token as
 * `apiKey`.
 *
 * Chat only: image/video generation is not exposed through the subscription
 * OAuth scope.
 */
export const LobeSuperGrokAI = createOpenAICompatibleRuntime({
  baseURL: 'https://api.x.ai/v1',
  chatCompletion: {
    handlePayload: handleXAIChatCompletionPayload,
    useResponse: true,
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_SUPERGROK_CHAT_COMPLETION === '1',
    responses: () => process.env.DEBUG_SUPERGROK_RESPONSES === '1',
  },
  models: async ({ client }) => {
    const modelsPage = (await client.models.list()) as any;
    const modelList: XAIModelCard[] = modelsPage.data;

    return processModelList(modelList, MODEL_LIST_CONFIGS.xai, 'supergrok');
  },
  provider: ModelProvider.SuperGrok,
  responses: {
    handlePayload: handleXAIResponsesPayload,
  },
});

import { ModelProvider } from 'model-bank';

import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { MODEL_LIST_CONFIGS, processModelList } from '../../utils/modelParse';
import {
  handleXAIChatCompletionPayload,
  handleXAIResponsesPayload,
  type XAIModelCard,
} from '../xai';

/**
 * SuperGrok / X Premium subscription access to Grok models via the Grok Build
 * CLI inference proxy (`cli-chat-proxy.grok.com/v1`). This gives access to
 * Grok Build and Composer models not exposed on the public xAI API.
 *
 * Authenticates with an OAuth access token (refreshed server-side via
 * `apps/server` oauthDeviceFlow), same as before — only the endpoint changes.
 */
export const LobeSuperGrokAI = createOpenAICompatibleRuntime({
  baseURL: 'https://cli-chat-proxy.grok.com/v1',
  chatCompletion: {
    handlePayload: handleXAIChatCompletionPayload,
    useResponse: true,
  },
  constructorOptions: {
    defaultHeaders: {
      'User-Agent': 'grok-pager/0.2.93 grok-shell/0.2.93 (linux; x86_64)',
      'X-XAI-Token-Auth': 'xai-grok-cli',
      'x-grok-client-identifier': 'grok-pager',
      'x-grok-client-version': '0.2.93',
    },
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

import type { ModelProviderCard } from '@/types/llm';

import { tokenlabChatModels } from '../aiModels/tokenlab';

const TokenLab: ModelProviderCard = {
  chatModels: tokenlabChatModels,
  checkModel: 'gpt-5.5',
  description:
    'TokenLab provides access to frontier chat models through OpenAI-compatible, Responses, Anthropic Messages, and Gemini-native API surfaces.',
  id: 'tokenlab',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://api.tokenlab.sh/v1/models',
  name: 'TokenLab',
  settings: {
    proxyUrl: {
      placeholder: 'https://api.tokenlab.sh/v1',
    },
    sdkType: 'router',
    showModelFetcher: true,
    supportResponsesApi: true,
  },
  url: 'https://tokenlab.sh',
};

export default TokenLab;

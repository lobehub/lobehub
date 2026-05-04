import { LobeOllamaAI } from '../ollama';

const OLLAMA_CLOUD_BASE_URL = 'https://ollama.com';

export const params = {
  baseURL: OLLAMA_CLOUD_BASE_URL,
  debug: {
    chatCompletion: () => process.env.DEBUG_OLLAMA_CLOUD_CHAT_COMPLETION === '1',
  },
  provider: 'ollamacloud',
  authMethod: 'authToken',
};

export class LobeOllamaCloudAI extends LobeOllamaAI {
  constructor({ baseURL, apiKey }: { baseURL?: string; apiKey?: string } = {}) {
    super({ baseURL: baseURL || OLLAMA_CLOUD_BASE_URL, apiKey });
  }
}

export default LobeOllamaCloudAI;

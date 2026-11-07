import type { PipelineContext } from './types';

export const createContext = (messages: PipelineContext['messages']): PipelineContext => ({
  initialState: {
    messages: [],
    model: 'gpt-4',
    provider: 'openai',
    systemRole: '',
    tools: [],
  },
  messages,
  metadata: {
    model: 'gpt-4',
    maxTokens: 4096,
  },
  isAborted: false,
});

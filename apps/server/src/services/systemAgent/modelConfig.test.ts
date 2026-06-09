import { describe, expect, it } from 'vitest';

import { resolveSystemAgentModelConfig } from './modelConfig';

describe('resolveSystemAgentModelConfig', () => {
  it('should keep a configured LobeHub chat model', async () => {
    const result = await resolveSystemAgentModelConfig({
      taskConfig: {
        model: 'deepseek-v4-pro',
        provider: 'lobehub',
      },
      taskKey: 'topic',
    });

    expect(result).toEqual({ model: 'deepseek-v4-pro', provider: 'lobehub' });
  });

  it('should let runtime hooks resolve LobeHub model mapping', async () => {
    const result = await resolveSystemAgentModelConfig({
      taskConfig: {
        model: 'mapped-topic-model',
        provider: 'lobehub',
      },
      taskKey: 'topic',
    });

    expect(result).toEqual({ model: 'mapped-topic-model', provider: 'lobehub' });
  });

  it('should keep deprecated LobeHub model ids for runtime-level rejection', async () => {
    const result = await resolveSystemAgentModelConfig({
      taskConfig: {
        model: 'ag/gemini-3.1-pro-high',
        provider: 'lobehub',
      },
      taskKey: 'topic',
    });

    expect(result).toEqual({ model: 'ag/gemini-3.1-pro-high', provider: 'lobehub' });
  });

  it('should keep non-LobeHub provider model ids untouched', async () => {
    const result = await resolveSystemAgentModelConfig({
      taskConfig: {
        model: 'private-model',
        provider: 'openai-compatible',
      },
      taskKey: 'topic',
    });

    expect(result).toEqual({ model: 'private-model', provider: 'openai-compatible' });
  });
});

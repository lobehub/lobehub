// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * This file contains the root router of your tRPC-backend
 */
import { createCallerFactory } from '@/libs/trpc/lambda';
import { type AuthContext } from '@/libs/trpc/lambda/context';
import { createContextInner } from '@/libs/trpc/lambda/context';

import { configRouter } from './index';

const createCaller = createCallerFactory(configRouter);
let ctx: AuthContext;
let router: ReturnType<typeof createCaller>;

beforeEach(async () => {
  vi.resetAllMocks();
  ctx = await createContextInner();
  router = createCaller(ctx);
});

describe('configRouter', () => {
  describe('getGlobalConfig', () => {
    describe('Model Provider env', () => {
      describe('OPENAI_MODEL_LIST', () => {
        it('custom deletion, addition, and renaming of models', async () => {
          process.env.OPENAI_MODEL_LIST =
            '-all,+llama,+claude-2，-gpt-3.5-turbo,gpt-4-0125-preview=gpt-4-turbo,gpt-4-0125-preview=gpt-4-32k';

          const response = await router.getGlobalConfig();

          // Assert
          const result = response.serverConfig.aiProvider?.openai;

          expect(result).toMatchSnapshot();
          process.env.OPENAI_MODEL_LIST = '';
        });

        it('should work correct with gpt-4', async () => {
          process.env.OPENAI_MODEL_LIST =
            '-all,+gpt-3.5-turbo-1106,+gpt-3.5-turbo,+gpt-4,+gpt-4-32k,+gpt-4-1106-preview,+gpt-4-vision';

          const response = await router.getGlobalConfig();

          const result = response.serverConfig.aiProvider?.openai?.serverModelLists;

          expect(result).toMatchSnapshot();

          process.env.OPENAI_MODEL_LIST = '';
        });

        it('duplicate naming model', async () => {
          process.env.OPENAI_MODEL_LIST =
            'gpt-4-0125-preview=gpt-4-turbo，gpt-4-0125-preview=gpt-4-32k';

          const response = await router.getGlobalConfig();

          const result = response.serverConfig.aiProvider?.openai?.serverModelLists;

          expect(result?.find((s) => s.id === 'gpt-4-0125-preview')?.displayName).toEqual(
            'gpt-4-32k',
          );

          process.env.OPENAI_MODEL_LIST = '';
        });

        it('should delete model', async () => {
          process.env.OPENAI_MODEL_LIST = '-gpt-4';

          const response = await router.getGlobalConfig();

          const result = response.serverConfig.aiProvider?.openai?.serverModelLists;

          expect(result?.find((r) => r.id === 'gpt-4')).toBeUndefined();

          process.env.OPENAI_MODEL_LIST = '';
        });

        it('show the hidden model', async () => {
          process.env.OPENAI_MODEL_LIST = '+gpt-4-1106-preview';

          const response = await router.getGlobalConfig();

          const result = response.serverConfig.aiProvider?.openai?.serverModelLists;

          const model = result?.find((o) => o.id === 'gpt-4-1106-preview');

          expect(model).toMatchSnapshot();

          process.env.OPENAI_MODEL_LIST = '';
        });

        it('only add the model', async () => {
          process.env.OPENAI_MODEL_LIST = 'model1,model2,model3，model4';

          const response = await router.getGlobalConfig();

          const result = response.serverConfig.aiProvider?.openai?.serverModelLists;

          expect(result).toContainEqual(
            expect.objectContaining({
              displayName: 'model1',
              id: 'model1',
              enabled: true,
            }),
          );
          expect(result).toContainEqual(
            expect.objectContaining({
              displayName: 'model2',
              enabled: true,
              id: 'model2',
            }),
          );
          expect(result).toContainEqual(
            expect.objectContaining({
              displayName: 'model3',
              enabled: true,
              id: 'model3',
            }),
          );
          expect(result).toContainEqual(
            expect.objectContaining({
              displayName: 'model4',
              enabled: true,
              id: 'model4',
            }),
          );

          process.env.OPENAI_MODEL_LIST = '';
        });
      });

      describe('OPENROUTER_MODEL_LIST', () => {
        it('custom deletion, addition, and renaming of models', async () => {
          process.env.OPENROUTER_MODEL_LIST =
            '-all,+meta-llama/llama-3.1-8b-instruct:free,+google/gemma-2-9b-it:free';

          const response = await router.getGlobalConfig();

          // Assert
          const result = response.serverConfig.aiProvider?.openrouter;

          expect(result).toMatchSnapshot();

          process.env.OPENROUTER_MODEL_LIST = '';
        });
      });
    });
  });

  describe('getDefaultAgentConfig', () => {
    it('should return the default agent config', async () => {
      process.env.DEFAULT_AGENT_CONFIG =
        'plugins=search-engine,lobe-image-designer;enableAutoCreateTopic=true;model=gemini-pro;provider=google;';

      const response = await router.getDefaultAgentConfig();

      expect(response).toEqual({
        enableAutoCreateTopic: true,
        model: 'gemini-pro',
        plugins: ['search-engine', 'lobe-image-designer'],
        provider: 'google',
      });

      process.env.DEFAULT_AGENT_CONFIG = '';
    });

    it('should return another config', async () => {
      process.env.DEFAULT_AGENT_CONFIG =
        'model=meta-11ama/11ama-3-70b-instruct:nitro;provider=openrouter;enableAutoCreateTopic=true;params.max_tokens=700';

      const response = await router.getDefaultAgentConfig();

      expect(response).toEqual({
        enableAutoCreateTopic: true,
        model: 'meta-11ama/11ama-3-70b-instruct:nitro',
        params: { max_tokens: 700 },
        provider: 'openrouter',
      });

      process.env.DEFAULT_AGENT_CONFIG = '';
    });
  });
});

import { vi } from 'vitest';

/**
 * Factory for the `@/server/modules/ModelRuntime` mock the agent-runtime suites share.
 *
 * The default runtime emits a minimal non-empty completion so the call_llm
 * empty-completion guard doesn't treat it as a "gave up" turn and throw
 * `ModelEmptyError`. Tests that exercise real output override `chat`.
 *
 * Extracted from `RuntimeExecutors.test.ts` — an oversized suite — so a new export the
 * transport needs (`resolveProviderResponseApiMode`, resolved once per provider by
 * `ServerLLMTransport`) costs one import instead of growing that file.
 */
export const createModelRuntimeMock = () => ({
  initModelRuntimeFromDB: vi.fn().mockResolvedValue({
    chat: vi.fn().mockImplementation(async (_payload: any, options: any) => {
      await options?.callback?.onText?.('done');
      return new Response('done');
    }),
  }),
  // `undefined` keeps the model-runtime default, i.e. the pre-existing behaviour.
  resolveProviderResponseApiMode: vi.fn(async () => undefined),
});

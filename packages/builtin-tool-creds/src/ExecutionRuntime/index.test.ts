import { describe, expect, it, vi } from 'vitest';

import { CredsExecutionRuntime, type ICredsService } from './index';

const createRuntime = (injectCreds: ICredsService['injectCreds']) =>
  new CredsExecutionRuntime({ injectCreds } as unknown as ICredsService, {
    topicId: 'topic-1',
    userId: 'user-1',
  });

describe('CredsExecutionRuntime.injectCredsToSandbox', () => {
  it('does not report a credential the sandbox could not take as injected', async () => {
    const runtime = createRuntime(
      vi.fn().mockResolvedValue({
        credentials: { env: { OPENAI_API_KEY: 'sk******90' } },
        notFound: ['missing'],
        success: false,
        unsupportedInSandbox: ['github'],
      }),
    );

    const result = await runtime.injectCredsToSandbox({ keys: ['openai', 'github', 'missing'] });

    expect(result.content).toBe(
      'Credentials injected successfully: openai. Not found: missing. Please configure them in Settings > Credentials. Not supported in sandbox: github.',
    );
    expect(result.state).toMatchObject({ injected: ['openai'] });
  });

  it('reports nothing as injected when every key is unsupported', async () => {
    const runtime = createRuntime(
      vi.fn().mockResolvedValue({
        credentials: { env: {} },
        notFound: [],
        success: false,
        unsupportedInSandbox: ['github'],
      }),
    );

    const result = await runtime.injectCredsToSandbox({ keys: ['github'] });

    expect(result.content).toBe('Not supported in sandbox: github.');
    expect(result.state).toMatchObject({ injected: [] });
  });
});

import { describe, expect, it, vi } from 'vitest';

import { kimiCodeDriver } from './kimiCode';

describe('kimiCodeDriver', () => {
  it('builds exact fresh and resumed one-shot plans', async () => {
    const buildAgentInput = vi.fn().mockResolvedValue({ args: ['--prompt', 'secret'], stdin: '' });
    const base = {
      args: ['--model', 'kimi-for-coding'],
      helpers: { buildAgentInput },
      promptInput: 'secret',
    } as any;

    await expect(kimiCodeDriver.buildSpawnPlan(base)).resolves.toEqual({
      args: ['--output-format', 'stream-json', '--model', 'kimi-for-coding', '--prompt', 'secret'],
      stdinPayload: '',
    });
    await expect(
      kimiCodeDriver.buildSpawnPlan({ ...base, resumeSessionId: 'session-1' }),
    ).resolves.toEqual({
      args: [
        '--output-format',
        'stream-json',
        '--session',
        'session-1',
        '--model',
        'kimi-for-coding',
        '--prompt',
        'secret',
      ],
      stdinPayload: '',
    });
    expect(buildAgentInput).toHaveBeenCalledWith('kimi-code', 'secret');
  });
});

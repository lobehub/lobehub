import { describe, expect, it } from 'vitest';

import type { PipelineContext } from '../../types';
import { ConnectorOwnershipInjector } from '../ConnectorOwnershipInjector';

const createContext = (messages: any[]) => ({
  initialState: { messages: [], model: 'gpt-4', provider: 'openai', systemRole: '', tools: [] },
  isAborted: false,
  messages,
  metadata: { maxTokens: 4096, model: 'gpt-4' },
});

const systemMessage = {
  content: 'You are a helpful assistant.',
  createdAt: Date.now(),
  id: 'system-1',
  role: 'system',
  updatedAt: Date.now(),
};

/** The single system message the providers append to; asserted, not assumed. */
const systemContentOf = (result: PipelineContext): string => {
  const system = result.messages.find((message) => message.role === 'system');
  if (!system) throw new Error('expected a system message');
  return system.content as string;
};

const run = async (config: ConstructorParameters<typeof ConnectorOwnershipInjector>[0]) =>
  new ConnectorOwnershipInjector(config).process(createContext([systemMessage]) as any);

describe('ConnectorOwnershipInjector', () => {
  it('appends the attribution note after the persona', async () => {
    const result = await run({ note: 'Gmail runs on Alice’s account.' });

    const system = systemContentOf(result);
    expect(system).toBe(
      'You are a helpful assistant.\n\nGmail runs on Alice’s account.',
    );
    expect(result.metadata.connectorOwnershipInjected).toBe(true);
  });

  it('does nothing when the run borrows no connectors', async () => {
    // The common case — the caller authorized everything — must cost nothing.
    for (const config of [{}, { note: '' }, { enabled: false, note: 'ignored' }]) {
      const result = await run(config);
      expect(systemContentOf(result)).toBe('You are a helpful assistant.');
      expect(result.metadata.connectorOwnershipInjected).toBeUndefined();
    }
  });
});

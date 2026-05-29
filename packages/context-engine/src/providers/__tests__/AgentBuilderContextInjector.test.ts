import { describe, expect, it } from 'vitest';

import type { PipelineContext } from '../../types';
import { AgentBuilderContextInjector } from '../AgentBuilderContextInjector';

describe('AgentBuilderContextInjector', () => {
  const createContext = (): PipelineContext => ({
    initialState: { messages: [] },
    isAborted: false,
    messages: [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
    ],
    metadata: {},
  });

  it('should include the full systemRole when it is under the preview limit', async () => {
    const head = 'A'.repeat(1622);
    const tail = '\n## Tail section\nKeep this content visible.';
    const systemRole = `${head}${tail}`;
    const injector = new AgentBuilderContextInjector({
      agentContext: {
        config: { systemRole },
      },
      enabled: true,
    });

    const result = await injector.process(createContext());
    const injected = result.messages[1].content;

    expect(injected).toContain(`<systemRole length="${systemRole.length}">`);
    expect(injected).toContain(tail);
    expect(injected).not.toContain(`${head}...`);
  });

  it('should truncate the systemRole only after 10000 characters', async () => {
    const head = 'A'.repeat(10_000);
    const tail = '\n## Hidden tail\nThis should not be injected.';
    const systemRole = `${head}${tail}`;
    const injector = new AgentBuilderContextInjector({
      agentContext: {
        config: { systemRole },
      },
      enabled: true,
    });

    const result = await injector.process(createContext());
    const injected = result.messages[1].content;

    expect(injected).toContain(`<systemRole length="${systemRole.length}">`);
    expect(injected).toContain(`${head}...`);
    expect(injected).not.toContain(tail);
  });
});

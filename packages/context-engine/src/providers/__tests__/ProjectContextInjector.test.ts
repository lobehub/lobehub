import { describe, expect, it } from 'vitest';

import type { PipelineContext } from '../../types';
import { ProjectContextInjector } from '../ProjectContextInjector';

const createContext = (messages: any[]): PipelineContext => ({
  initialState: { messages: [], model: 'test-model', provider: 'test-provider' },
  isAborted: false,
  messages,
  metadata: { maxTokens: 4000, model: 'test-model' },
});

describe('ProjectContextInjector', () => {
  it('appends the project context to the last user message', async () => {
    const injector = new ProjectContextInjector({
      contextPrompt: '<project identifier="APO" status="active">Apollo</project>',
      enabled: true,
    });

    const result = await injector.process(
      createContext([
        { content: 'first', role: 'user' },
        { content: 'reply', role: 'assistant' },
        { content: 'split the launch into tasks', role: 'user' },
      ]),
    );

    expect(result.messages[0].content).toBe('first');
    expect(result.messages[2].content).toContain('split the launch into tasks');
    expect(result.messages[2].content).toContain('<project_context>');
    expect(result.messages[2].content).toContain('Apollo');
    expect(result.metadata.projectContextInjected).toBe(true);
  });

  it('leaves the conversation untouched outside a project', async () => {
    const injector = new ProjectContextInjector({ enabled: false });

    const result = await injector.process(createContext([{ content: 'hello', role: 'user' }]));

    expect(result.messages[0].content).toBe('hello');
    expect(result.metadata.projectContextInjected).toBeUndefined();
  });
});

import { expect, it } from 'vitest';

import type { Message, PipelineContext } from '../../../types';
import { ContextReplayCoordinator } from './index';

it('preserves anonymous tool history when a provider is a no-op', async () => {
  const messages = [
    { role: 'user', content: 'Keep going' },
    {
      role: 'assistant',
      content: '',
      tool_calls: [{ id: 'call', type: 'function', function: { name: 'read', arguments: '{}' } }],
    },
    { role: 'tool', content: 'read result', tool_call_id: 'call' },
  ] as Message[];
  const context = { messages, metadata: {} } as PipelineContext;
  const coordinator = new ContextReplayCoordinator({ invocationId: 'answer' }, 'model:agent');
  const result = await coordinator
    .wrap({ name: 'AgentAccountContextInjector', process: async (input) => structuredClone(input) })
    .process(context);
  const materialized = await coordinator.materialize.process(result);
  expect(materialized.messages).toEqual(messages);
  expect(materialized.metadata.contextReplaySnapshot?.changes).toEqual([]);
});

it('captures only an anonymous message addition without copying the other messages', async () => {
  const messages = [
    { role: 'user', content: 'Question' },
    { role: 'assistant', content: 'Answer' },
  ] as Message[];
  const context = { messages, metadata: {} } as PipelineContext;
  const coordinator = new ContextReplayCoordinator({ invocationId: 'answer' }, 'model:agent');
  const result = await coordinator
    .wrap({
      name: 'RuntimeAdditionalContextProvider',
      process: async (input) => ({
        ...structuredClone(input),
        messages: input.messages.map((message) =>
          message.role === 'user'
            ? { ...message, content: message.content + '\nNew context' }
            : { ...message },
        ),
      }),
    })
    .process(context);
  const materialized = await coordinator.materialize.process(result);
  expect(materialized.messages.slice(0, 2)).toEqual(messages);
  expect(materialized.messages).toHaveLength(3);
  expect(materialized.messages[2].content).toContain('New context');
  expect(materialized.messages[2].content).not.toContain('Answer');
});

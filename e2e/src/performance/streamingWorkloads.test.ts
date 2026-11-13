import { describe, expect, it } from 'vitest';

import { buildSSEChunks, type ChatMessage } from '../mocks/llm';
import {
  streamingResponder,
  TOOLSTORM_CALLS,
  TOOLSTORM_FINAL_REPLY,
  WORKLOAD_FINAL_TEXT,
  workloadPrompt,
} from './streamingWorkloads';

const user = (content: string): ChatMessage => ({ content, role: 'user' });

describe('streamingResponder', () => {
  it('ignores prompts that are not a workload', () => {
    expect(streamingResponder([user('hello')])).toBeUndefined();
  });

  it('ends each text workload with the line the test waits for', () => {
    for (const workload of ['bigstream', 'richreply'] as const) {
      const reply = streamingResponder([user(workloadPrompt(workload))]);
      expect(reply?.text?.endsWith(WORKLOAD_FINAL_TEXT[workload])).toBe(true);
      expect(reply?.toolCalls).toBeUndefined();
    }
  });

  it('calls the tools first, then answers once their results arrive', () => {
    const prompt = user(workloadPrompt('toolstorm'));
    const first = streamingResponder([prompt]);
    expect(first?.toolCalls).toHaveLength(TOOLSTORM_CALLS);

    const followUp = streamingResponder([
      prompt,
      { content: '', role: 'assistant' },
      { content: '2', role: 'tool' },
    ]);
    expect(followUp).toMatchObject({ text: TOOLSTORM_FINAL_REPLY });
    expect(followUp?.toolCalls).toBeUndefined();
  });

  it('starts over with tool calls when a new user message follows older tool results', () => {
    const prompt = user(workloadPrompt('toolstorm'));
    const reply = streamingResponder([prompt, { content: '2', role: 'tool' }, prompt]);
    expect(reply?.toolCalls).toHaveLength(TOOLSTORM_CALLS);
  });
});

describe('buildSSEChunks', () => {
  const events = (chunks: string[]) =>
    chunks.map((chunk) => {
      const [, event] = /event: (\w+)/.exec(chunk)!;
      const [, data] = /data: (.*)\n\n$/s.exec(chunk)!;
      return { data: JSON.parse(data), event };
    });

  it('streams each tool call as a named head and an argument tail that join back', () => {
    const args = JSON.stringify({ expression: '6 * 7' });
    const parsed = events(
      buildSSEChunks('', 10, [{ arguments: args, id: 'call_1', name: 'calc' }]),
    );
    const toolEvents = parsed.filter(({ event }) => event === 'tool_calls');

    expect(toolEvents).toHaveLength(2);
    expect(toolEvents[0].data[0].function.name).toBe('calc');
    expect(toolEvents[1].data[0].function.name).toBeUndefined();
    expect(toolEvents.map(({ data }) => data[0].function.arguments).join('')).toBe(args);
    expect(parsed.find(({ event }) => event === 'stop')?.data).toBe('tool_use');
  });

  it('keeps end_turn for a text-only reply', () => {
    const parsed = events(buildSSEChunks('hello', 10));
    expect(parsed.find(({ event }) => event === 'stop')?.data).toBe('end_turn');
  });
});

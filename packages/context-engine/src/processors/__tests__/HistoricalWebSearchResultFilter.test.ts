import { describe, expect, it } from 'vitest';

import type { PipelineContext } from '../../types';
import { HistoricalWebSearchResultFilter } from '../HistoricalWebSearchResultFilter';

const createContext = (messages: any[]): PipelineContext => ({
  initialState: { messages } as any,
  isAborted: false,
  messages,
  metadata: { maxTokens: 4096, model: 'gpt-4' },
});

const webSearchTool = {
  apiName: 'search',
  arguments: '{"query":"latest LobeHub release"}',
  id: 'call_web_history',
  identifier: 'lobe-web-browsing',
  type: 'builtin',
};

const calculatorTool = {
  apiName: 'add',
  arguments: '{"a":1,"b":2}',
  id: 'call_calc_history',
  identifier: 'calculator',
  type: 'builtin',
};

describe('HistoricalWebSearchResultFilter', () => {
  it('removes historical web search tool calls and results before the latest user turn', async () => {
    const processor = new HistoricalWebSearchResultFilter();

    const result = await processor.process(
      createContext([
        { content: 'search the web', id: 'u1', role: 'user' },
        {
          content: '',
          id: 'a1',
          role: 'assistant',
          tools: [webSearchTool],
        },
        {
          content: '<searchResults>large historical payload</searchResults>',
          id: 't1',
          plugin: webSearchTool,
          role: 'tool',
          tool_call_id: webSearchTool.id,
        },
        {
          content: 'Here is the answer from search.',
          id: 'a2',
          role: 'assistant',
          search: { citations: [{ title: 'Source', url: 'https://example.com' }] },
        },
        { content: 'next question', id: 'u2', role: 'user' },
      ]),
    );

    expect(result.messages.map((message) => message.id)).toEqual(['u1', 'a1', 'a2', 'u2']);
    expect(result.messages.find((message) => message.id === 'a1')).not.toHaveProperty('tools');
    expect(result.messages.find((message) => message.id === 'a2')?.search).toEqual({
      citations: [{ title: 'Source', url: 'https://example.com' }],
    });
    expect(result.metadata.historicalWebSearchResultFilter).toMatchObject({
      removedToolMessages: 1,
      strippedAssistantMessages: 1,
      strippedToolCalls: 1,
    });
  });

  it('keeps current-turn web search results after the latest user turn', async () => {
    const processor = new HistoricalWebSearchResultFilter();

    const result = await processor.process(
      createContext([
        { content: 'previous question', id: 'u1', role: 'user' },
        { content: 'previous answer', id: 'a1', role: 'assistant' },
        { content: 'search now', id: 'u2', role: 'user' },
        {
          content: '',
          id: 'a2',
          role: 'assistant',
          tools: [webSearchTool],
        },
        {
          content: '<searchResults>current payload</searchResults>',
          id: 't2',
          plugin: webSearchTool,
          role: 'tool',
          tool_call_id: webSearchTool.id,
        },
      ]),
    );

    expect(result.messages.map((message) => message.id)).toEqual(['u1', 'a1', 'u2', 'a2', 't2']);
    expect(result.messages.find((message) => message.id === 'a2')?.tools).toHaveLength(1);
    expect(result.metadata.historicalWebSearchResultFilter).toMatchObject({
      removedToolMessages: 0,
      strippedAssistantMessages: 0,
      strippedToolCalls: 0,
    });
  });

  it('leaves non-web-search historical tools untouched', async () => {
    const processor = new HistoricalWebSearchResultFilter();

    const result = await processor.process(
      createContext([
        { content: 'calculate', id: 'u1', role: 'user' },
        {
          content: '',
          id: 'a1',
          role: 'assistant',
          tools: [calculatorTool],
        },
        {
          content: '{"result":3}',
          id: 't1',
          plugin: calculatorTool,
          role: 'tool',
          tool_call_id: calculatorTool.id,
        },
        { content: 'next question', id: 'u2', role: 'user' },
      ]),
    );

    expect(result.messages.map((message) => message.id)).toEqual(['u1', 'a1', 't1', 'u2']);
    expect(result.messages.find((message) => message.id === 'a1')?.tools).toHaveLength(1);
  });
});

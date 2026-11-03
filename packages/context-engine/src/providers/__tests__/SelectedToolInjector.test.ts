import { describe, expect, it } from 'vitest';

import type { PipelineContext } from '../../types';
import { SelectedToolInjector } from '../SelectedToolInjector';

const createContext = (messages: any[] = []): PipelineContext => ({
  initialState: {
    messages: [],
    model: 'gpt-4',
    provider: 'openai',
  },
  isAborted: false,
  messages,
  metadata: {
    maxTokens: 4096,
    model: 'gpt-4',
  },
});

describe('SelectedToolInjector', () => {
  it('should skip when no tools selected', async () => {
    const provider = new SelectedToolInjector({ selectedTools: [] });

    const context = createContext([{ content: 'Current request', id: 'user-1', role: 'user' }]);

    const result = await provider.process(context);

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].content).toBe('Current request');
    expect(result.metadata.selectedToolContext).toBeUndefined();
  });

  it('should inject selected tools into the last user message', async () => {
    const provider = new SelectedToolInjector({
      selectedTools: [
        { identifier: 'web-search', name: 'Web Search' },
        { identifier: 'code-interpreter', name: 'Code Interpreter' },
      ],
    });

    const context = createContext([
      { content: 'Earlier question', id: 'user-1', role: 'user' },
      { content: 'Assistant reply', id: 'assistant-1', role: 'assistant' },
      { content: 'Current request', id: 'user-2', role: 'user' },
    ]);

    const result = await provider.process(context);

    expect(result.messages).toHaveLength(3);
    expect(result.messages[2].content).toContain('Current request');
    expect(result.messages[2].content).toContain('<selected_tool_context>');
    expect(result.messages[2].content).toContain('<selected_tools>');
    expect(result.messages[2].content).toContain(
      '<tool identifier="web-search" name="Web Search" />',
    );
    expect(result.metadata.selectedToolContext).toEqual({
      injected: true,
      toolsCount: 2,
    });
  });

  it('should inject tool content inline when available', async () => {
    const provider = new SelectedToolInjector({
      selectedTools: [
        {
          content: 'Search the web for information.\n\nAvailable APIs:\n- search: Search the web',
          identifier: 'web-search',
          name: 'Web Search',
        },
        { identifier: 'dalle', name: 'DALL-E' },
      ],
    });

    const context = createContext([
      { content: 'Find info about cats', id: 'user-1', role: 'user' },
    ]);

    const result = await provider.process(context);

    const content = result.messages[0].content as string;
    // Tool with content: rendered as open/close tag with content inside
    expect(content).toContain('<tool identifier="web-search" name="Web Search">');
    expect(content).toContain('Search the web for information.');
    expect(content).toContain('</tool>');
    // Tool without content: self-closing tag
    expect(content).toContain('<tool identifier="dalle" name="DALL-E" />');
  });

  it('should skip when disabled', async () => {
    const provider = new SelectedToolInjector({
      enabled: false,
      selectedTools: [{ identifier: 'web-search', name: 'Web Search' }],
    });

    const context = createContext([{ content: 'Current request', id: 'user-1', role: 'user' }]);

    const result = await provider.process(context);

    expect(result.messages[0].content).toBe('Current request');
    expect(result.metadata.selectedToolContext).toBeUndefined();
  });
});

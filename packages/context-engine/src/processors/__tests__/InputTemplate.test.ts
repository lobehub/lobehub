import { describe, expect, it, vi } from 'vitest';

import { InputTemplateProcessor } from '../InputTemplate';

describe('InputTemplateProcessor', () => {
  it('should apply template to user messages', async () => {
    const processor = new InputTemplateProcessor({
      inputTemplate: 'Template: {{text}} - End',
    });

    const context = {
      initialState: {
        messages: [],
        model: 'gpt-4',
        provider: 'openai',
        systemRole: '',
        tools: [],
      },
      messages: [
        {
          id: '1',
          role: 'user',
          content: 'Original user message',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        {
          id: '2',
          role: 'assistant',
          content: 'Assistant response',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
      metadata: {
        model: 'gpt-4',
        maxTokens: 4096,
      },
      isAborted: false,
    };

    const result = await processor.process(context);

    expect(result.messages[0].content).toBe('Template: Original user message - End');
    expect(result.messages[1].content).toBe('Assistant response'); // Assistant message unchanged
    expect(result.metadata.inputTemplateProcessed).toBe(1);
  });

  it('should skip processing when no template is configured', async () => {
    const processor = new InputTemplateProcessor({});

    const context = {
      initialState: {
        messages: [],
        model: 'gpt-4',
        provider: 'openai',
        systemRole: '',
        tools: [],
      },
      messages: [
        {
          id: '1',
          role: 'user',
          content: 'User message',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
      metadata: {
        model: 'gpt-4',
        maxTokens: 4096,
      },
      isAborted: false,
    };

    const result = await processor.process(context);

    expect(result.messages[0].content).toBe('User message'); // Unchanged
    expect(result.metadata.inputTemplateProcessed).toBeUndefined();
  });

  it('should handle template without {{text}} placeholder', async () => {
    const processor = new InputTemplateProcessor({
      inputTemplate: 'Static template content',
    });

    const context = {
      initialState: {
        messages: [],
        model: 'gpt-4',
        provider: 'openai',
        systemRole: '',
        tools: [],
      },
      messages: [
        {
          id: '1',
          role: 'user',
          content: 'Original message',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
      metadata: {
        model: 'gpt-4',
        maxTokens: 4096,
      },
      isAborted: false,
    };

    const result = await processor.process(context);

    expect(result.messages[0].content).toBe('Static template content');
    expect(result.metadata.inputTemplateProcessed).toBe(1);
  });

  it('should handle template compilation errors gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const processor = new InputTemplateProcessor({
      inputTemplate: '<%- invalid javascript code %>',
    });

    const context = {
      initialState: {
        messages: [],
        model: 'gpt-4',
        provider: 'openai',
        systemRole: '',
        tools: [],
      },
      messages: [
        {
          id: '1',
          role: 'user',
          content: 'User message',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
      metadata: {
        model: 'gpt-4',
        maxTokens: 4096,
      },
      isAborted: false,
    };

    const result = await processor.process(context);

    // Should skip processing due to compilation error
    expect(result.messages[0].content).toBe('User message'); // Original content preserved
    expect(result.metadata.inputTemplateProcessed).toBe(0);

    consoleSpy.mockRestore();
  });

  it('should handle template application errors gracefully', async () => {
    const processor = new InputTemplateProcessor({
      inputTemplate: '{{text}} <%- throw new Error("Application error") %>',
    });

    const context = {
      initialState: {
        messages: [],
        model: 'gpt-4',
        provider: 'openai',
        systemRole: '',
        tools: [],
      },
      messages: [
        {
          id: '1',
          role: 'user',
          content: 'User message',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
      metadata: {
        model: 'gpt-4',
        maxTokens: 4096,
      },
      isAborted: false,
    };

    const result = await processor.process(context);

    // Should keep original message when template application fails
    expect(result.messages[0].content).toBe('User message');
    expect(result.metadata.inputTemplateProcessed).toBe(0);
  });

  it('should only process user messages, not assistant messages', async () => {
    const processor = new InputTemplateProcessor({
      inputTemplate: 'Processed: {{text}}',
    });

    const context = {
      initialState: {
        messages: [],
        model: 'gpt-4',
        provider: 'openai',
        systemRole: '',
        tools: [],
      },
      messages: [
        {
          id: '1',
          role: 'user',
          content: 'User message',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        {
          id: '2',
          role: 'assistant',
          content: 'Assistant message',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        {
          id: '3',
          role: 'system',
          content: 'System message',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
      metadata: {
        model: 'gpt-4',
        maxTokens: 4096,
      },
      isAborted: false,
    };

    const result = await processor.process(context);

    expect(result.messages[0].content).toBe('Processed: User message');
    expect(result.messages[1].content).toBe('Assistant message'); // Unchanged
    expect(result.messages[2].content).toBe('System message'); // Unchanged
    expect(result.metadata.inputTemplateProcessed).toBe(1);
  });

  // A background sub-agent's report arrives as a user message from that
  // sub-agent; the template is for what the human typed.
  it('leaves a sub-agent result message untouched', async () => {
    const processor = new InputTemplateProcessor({ inputTemplate: 'Template: {{text}} - End' });

    const result = await processor.process({
      initialState: { messages: [], model: 'gpt-4', provider: 'openai', systemRole: '', tools: [] },
      isAborted: false,
      messages: [
        {
          content: 'The poem',
          createdAt: Date.now(),
          id: '1',
          metadata: { subAgentCallback: { name: 'Poet', status: 'completed', threadId: 'thd' } },
          role: 'user',
          updatedAt: Date.now(),
        },
      ],
      metadata: { maxTokens: 4096, model: 'gpt-4' },
    } as any);

    expect(result.messages[0].content).toBe('The poem');
  });
});

import { describe, expect, it } from 'vitest';

import type { PipelineContext } from '../../types';
import { AgentDocumentInjector } from '../AgentDocumentInjector';

describe('AgentDocumentInjector', () => {
  const createContext = (messages: any[] = []): PipelineContext => ({
    initialState: {
      messages: [],
      model: 'gpt-4o',
      provider: 'openai',
    },
    isAborted: false,
    messages,
    metadata: {
      maxTokens: 4096,
      model: 'gpt-4o',
    },
  });

  it('should inject generic documents by load position and set metadata', async () => {
    const provider = new AgentDocumentInjector({
      documents: [
        {
          content: 'Core runtime guardrails',
          filename: 'guardrails.md',
          loadPosition: 'before-first-user',
          loadRules: { priority: 1, rule: 'always' },
          policyId: 'claw',
        },
        {
          content: 'Session summary memo',
          filename: 'summary.md',
          loadPosition: 'context-end',
          loadRules: { rule: 'always' },
          policyId: 'custom',
        },
      ],
    });

    const context = createContext([
      { content: 'System prompt', id: 'sys-1', role: 'system' },
      { content: 'Hello', id: 'user-1', role: 'user' },
    ]);

    const result = await provider.process(context);

    expect(result.messages).toHaveLength(4);
    expect(result.messages[1].role).toBe('system');
    expect(result.messages[1].content).toContain('Core runtime guardrails');
    expect(result.messages[3].role).toBe('system');
    expect(result.messages[3].content).toContain('Session summary memo');
    expect(result.metadata.agentDocumentsInjected).toBe(true);
    expect(result.metadata.agentDocumentsCount).toBe(2);
    expect(result.metadata.agentDocuments).toMatchObject({
      policyIds: ['claw', 'custom'],
    });
  });

  it('should not inject document when by-keywords rule does not match', async () => {
    const provider = new AgentDocumentInjector({
      currentUserMessage: 'Please focus on tomorrow action items',
      documents: [
        {
          content: 'Only show for release keyword',
          filename: 'todo.md',
          loadRules: { keywords: ['release'], rule: 'by-keywords' },
        },
      ],
    });

    const context = createContext([{ content: 'Hello', id: 'user-1', role: 'user' }]);
    const result = await provider.process(context);

    expect(result.metadata.agentDocumentsInjected).toBeUndefined();
    expect(result.metadata.agentDocumentsCount).toBeUndefined();
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].content).toBe('Hello');
  });

  it('should keep raw format unwrapped by default', async () => {
    const provider = new AgentDocumentInjector({
      documents: [
        {
          content: 'Direct instruction content',
          filename: 'instruction.md',
          loadPosition: 'before-first-user',
          loadRules: { rule: 'always' },
        },
      ],
    });

    const context = createContext([{ content: 'Hello', id: 'user-1', role: 'user' }]);
    const result = await provider.process(context);

    expect(result.messages[0].content).toContain('Direct instruction content');
    expect(result.messages[0].content).not.toContain('<agent_document');
  });

  it('should inject document when by-keywords rule matches', async () => {
    const provider = new AgentDocumentInjector({
      currentUserMessage: 'Please draft the launch checklist for next week',
      documents: [
        {
          content: 'Checklist template',
          filename: 'checklist.md',
          loadRules: {
            keywords: ['checklist', 'launch'],
            keywordMatchMode: 'all',
            rule: 'by-keywords',
          },
        },
      ],
    });

    const context = createContext([{ content: 'Hello', id: 'user-1', role: 'user' }]);
    const result = await provider.process(context);

    expect(result.metadata.agentDocumentsInjected).toBe(true);
    expect(result.messages[0].content).toContain('Checklist template');
  });

  it('should inject document when by-regexp rule matches', async () => {
    const provider = new AgentDocumentInjector({
      currentUserMessage: 'Need TODO items for this sprint',
      documents: [
        {
          content: 'Sprint TODO policy',
          filename: 'todo.md',
          loadRules: { regexp: '\\btodo\\b', rule: 'by-regexp' },
        },
      ],
    });

    const context = createContext([{ content: 'Hello', id: 'user-1', role: 'user' }]);
    const result = await provider.process(context);

    expect(result.metadata.agentDocumentsInjected).toBe(true);
    expect(result.messages[0].content).toContain('Sprint TODO policy');
  });

  it('should inject document only inside by-time-range window', async () => {
    const provider = new AgentDocumentInjector({
      currentTime: new Date('2026-03-13T12:00:00.000Z'),
      documents: [
        {
          content: 'Noon policy',
          filename: 'noon.md',
          loadRules: {
            rule: 'by-time-range',
            timeRange: { from: '2026-03-13T11:00:00.000Z', to: '2026-03-13T13:00:00.000Z' },
          },
        },
      ],
    });

    const context = createContext([{ content: 'Hello', id: 'user-1', role: 'user' }]);
    const result = await provider.process(context);

    expect(result.metadata.agentDocumentsInjected).toBe(true);
    expect(result.messages[0].content).toContain('Noon policy');
  });

  it('should wrap file format content with agent_document tag', async () => {
    const provider = new AgentDocumentInjector({
      documents: [
        {
          content: 'File mode content',
          filename: 'rules.md',
          id: 'doc-1',
          loadPosition: 'before-first-user',
          loadRules: { rule: 'always' },
          policyLoadFormat: 'file',
          title: 'Rules',
        },
      ],
    });

    const context = createContext([{ content: 'Hello', id: 'user-1', role: 'user' }]);
    const result = await provider.process(context);

    expect(result.messages[0].content).toContain('<agent_document');
    expect(result.messages[0].content).toContain('id="doc-1"');
    expect(result.messages[0].content).toContain('filename="rules.md"');
    expect(result.messages[0].content).toContain('title="Rules"');
    expect(result.messages[0].content).toContain('File mode content');
    expect(result.messages[0].content).toContain('</agent_document>');
  });
});

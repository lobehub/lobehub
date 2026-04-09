import { describe, expect, it } from 'vitest';

import type { PipelineContext } from '../../types';
import {
  AgentDocumentBeforeSystemInjector,
  AgentDocumentContextInjector,
  AgentDocumentMessageInjector,
  AgentDocumentSystemAppendInjector,
  AgentDocumentSystemReplaceInjector,
} from '../AgentDocumentInjector';

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

  describe('AgentDocumentContextInjector (before-first-user)', () => {
    it('should inject documents before first user message', async () => {
      const provider = new AgentDocumentContextInjector({
        documents: [
          {
            content: 'Core runtime guardrails',
            filename: 'guardrails.md',
            loadPosition: 'before-first-user',
            loadRules: { priority: 1, rule: 'always' },
            policyId: 'claw',
          },
        ],
      });

      const context = createContext([
        { content: 'System prompt', id: 'sys-1', role: 'system' },
        { content: 'Hello', id: 'user-1', role: 'user' },
      ]);

      const result = await provider.process(context);

      expect(result.messages).toHaveLength(3);
      expect(result.messages[1].content).toContain('Core runtime guardrails');
    });

    it('should not inject document when by-keywords rule does not match', async () => {
      const provider = new AgentDocumentContextInjector({
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

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].content).toBe('Hello');
    });

    it('should keep raw format unwrapped by default', async () => {
      const provider = new AgentDocumentContextInjector({
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
      const provider = new AgentDocumentContextInjector({
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

      expect(result.messages[0].content).toContain('Checklist template');
    });

    it('should inject document when by-regexp rule matches', async () => {
      const provider = new AgentDocumentContextInjector({
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

      expect(result.messages[0].content).toContain('Sprint TODO policy');
    });

    it('should inject document only inside by-time-range window', async () => {
      const provider = new AgentDocumentContextInjector({
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

      expect(result.messages[0].content).toContain('Noon policy');
    });

    it('should wrap file format content with agent_document tag', async () => {
      const provider = new AgentDocumentContextInjector({
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

    it('should inject progressive documents as index instead of full content', async () => {
      const provider = new AgentDocumentContextInjector({
        documents: [
          {
            content: 'Full content that should NOT appear',
            description: 'Core safety rules',
            filename: 'guardrails.md',
            id: 'doc-1',
            loadPosition: 'before-first-user',
            loadRules: { rule: 'always' },
            policyLoad: 'progressive',
            title: 'Guardrails',
          },
          {
            content: 'Another full content that should NOT appear',
            filename: 'notes.txt',
            id: 'doc-2',
            loadPosition: 'before-first-user',
            loadRules: { rule: 'always' },
            policyLoad: 'progressive',
            title: 'Notes',
          },
        ],
      });

      const context = createContext([{ content: 'Hello', id: 'user-1', role: 'user' }]);
      const result = await provider.process(context);

      const injected = result.messages[0].content;
      expect(injected).toContain('<agent_documents_index>');
      expect(injected).toContain('[doc-1]');
      expect(injected).toContain('guardrails.md');
      expect(injected).toContain('"Guardrails"');
      expect(injected).toContain('Core safety rules');
      expect(injected).toContain('[doc-2]');
      expect(injected).toContain('notes.txt');
      expect(injected).not.toContain('Full content that should NOT appear');
      expect(injected).not.toContain('Another full content that should NOT appear');
      expect(injected).toContain('</agent_documents_index>');
    });

    it('should mix full-content and progressive documents', async () => {
      const provider = new AgentDocumentContextInjector({
        documents: [
          {
            content: 'Always-loaded full content',
            filename: 'full.md',
            loadPosition: 'before-first-user',
            loadRules: { rule: 'always' },
            policyLoad: 'always',
          },
          {
            content: 'Progressive content hidden',
            description: 'A summary doc',
            filename: 'summary.md',
            id: 'doc-p',
            loadPosition: 'before-first-user',
            loadRules: { rule: 'always' },
            policyLoad: 'progressive',
            title: 'Summary',
          },
        ],
      });

      const context = createContext([{ content: 'Hello', id: 'user-1', role: 'user' }]);
      const result = await provider.process(context);

      const injected = result.messages[0].content;
      expect(injected).toContain('Always-loaded full content');
      expect(injected).toContain('<agent_documents_index>');
      expect(injected).toContain('summary.md');
      expect(injected).not.toContain('Progressive content hidden');
    });
  });

  describe('AgentDocumentBeforeSystemInjector (before-system)', () => {
    it('should prepend documents before system message', async () => {
      const provider = new AgentDocumentBeforeSystemInjector({
        documents: [
          {
            content: 'Before system content',
            filename: 'framework.md',
            loadPosition: 'before-system',
            loadRules: { rule: 'always' },
          },
        ],
      });

      const context = createContext([
        { content: 'Original system', id: 'sys-1', role: 'system' },
        { content: 'Hello', id: 'user-1', role: 'user' },
      ]);

      const result = await provider.process(context);

      expect(result.messages).toHaveLength(3);
      expect(result.messages[0].content).toContain('Before system content');
      expect(result.messages[1].content).toBe('Original system');
    });
  });

  describe('AgentDocumentSystemAppendInjector (system-append)', () => {
    it('should append documents to existing system message', async () => {
      const provider = new AgentDocumentSystemAppendInjector({
        documents: [
          {
            content: 'System append content',
            filename: 'system.md',
            loadPosition: 'system-append',
            loadRules: { rule: 'always' },
          },
        ],
      });

      const context = createContext([
        { content: 'Original system', id: 'sys-1', role: 'system' },
        { content: 'Hello', id: 'user-1', role: 'user' },
      ]);

      const result = await provider.process(context);

      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].content).toContain('Original system');
      expect(result.messages[0].content).toContain('System append content');
    });
  });

  describe('AgentDocumentSystemReplaceInjector (system-replace)', () => {
    it('should replace entire system message', async () => {
      const provider = new AgentDocumentSystemReplaceInjector({
        documents: [
          {
            content: 'Replacement content',
            filename: 'override.md',
            loadPosition: 'system-replace',
            loadRules: { rule: 'always' },
          },
        ],
      });

      const context = createContext([
        { content: 'Original system', id: 'sys-1', role: 'system' },
        { content: 'Hello', id: 'user-1', role: 'user' },
      ]);

      const result = await provider.process(context);

      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].content).toContain('Replacement content');
      expect(result.messages[0].content).not.toContain('Original system');
    });
  });

  describe('AgentDocumentMessageInjector (after-first-user, context-end)', () => {
    it('should inject documents at context end', async () => {
      const provider = new AgentDocumentMessageInjector({
        documents: [
          {
            content: 'Session summary memo',
            filename: 'summary.md',
            loadPosition: 'context-end',
            loadRules: { rule: 'always' },
          },
        ],
      });

      const context = createContext([
        { content: 'System prompt', id: 'sys-1', role: 'system' },
        { content: 'Hello', id: 'user-1', role: 'user' },
      ]);

      const result = await provider.process(context);

      expect(result.messages).toHaveLength(3);
      expect(result.messages[2].content).toContain('Session summary memo');
    });

    it('should inject documents after first user message', async () => {
      const provider = new AgentDocumentMessageInjector({
        documents: [
          {
            content: 'After user content',
            filename: 'after.md',
            loadPosition: 'after-first-user',
            loadRules: { rule: 'always' },
          },
        ],
      });

      const context = createContext([
        { content: 'System prompt', id: 'sys-1', role: 'system' },
        { content: 'Hello', id: 'user-1', role: 'user' },
        { content: 'Response', id: 'asst-1', role: 'assistant' },
      ]);

      const result = await provider.process(context);

      expect(result.messages).toHaveLength(4);
      expect(result.messages[2].content).toContain('After user content');
    });
  });
});

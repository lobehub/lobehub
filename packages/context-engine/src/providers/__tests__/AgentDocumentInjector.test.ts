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
            policyLoad: 'always',
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
            policyLoad: 'always',
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
            policyLoad: 'always',
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
            policyLoad: 'always',
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
            policyLoad: 'always',
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
            policyLoad: 'always',
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
            policyLoad: 'always',
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
        currentTime: new Date('2026-04-29T00:00:00.000Z'),
        documents: [
          {
            content: 'Full content that should NOT appear',
            filename: 'daily-brief.txt',
            id: '2af6eb88-8bdb-468f-887f-620baa394efa',
            loadPosition: 'before-first-user',
            loadRules: { rule: 'always' },
            policyLoad: 'progressive',
            sourceType: 'file',
            title: 'Daily Brief 提取框架',
            updatedAt: new Date('2026-04-27T00:00:00.000Z'),
          },
          {
            content: 'a'.repeat(6000),
            filename: 'cfg.txt',
            id: '32e12975-7db2-4818-8415-9b5c3d383f05',
            loadPosition: 'before-first-user',
            loadRules: { rule: 'always' },
            policyLoad: 'progressive',
            sourceType: 'file',
            title: 'cfg-constrained-decoding',
            updatedAt: new Date('2026-04-10T00:00:00.000Z'),
          },
        ],
      });

      const context = createContext([{ content: 'Hello', id: 'user-1', role: 'user' }]);
      const result = await provider.process(context);

      expect(result.messages[0].content).toMatchInlineSnapshot(`
        "<agent_documents_index>
        2 user-created docs. Use readDocument(id) for full content.

        TITLE                     ID                                    SIZE  UPDATED
        Daily Brief 提取框架          2af6eb88-8bdb-468f-887f-620baa394efa  35    2d ago
        cfg-constrained-decoding  32e12975-7db2-4818-8415-9b5c3d383f05  6.0k  19d ago
        </agent_documents_index>"
      `);
      expect(result.messages[0].content).not.toContain('Full content that should NOT appear');
    });

    it('should render progressive index sizes from contentCharCount when content is omitted', async () => {
      const provider = new AgentDocumentContextInjector({
        currentTime: new Date('2026-04-29T00:00:00.000Z'),
        documents: [
          {
            content: '',
            contentCharCount: 12_000,
            filename: 'large-note.txt',
            id: 'note-1',
            loadPosition: 'before-first-user',
            loadRules: { rule: 'always' },
            policyLoad: 'progressive',
            sourceType: 'file',
            title: 'Large Note',
            updatedAt: new Date('2026-04-27T00:00:00.000Z'),
          },
        ],
      });

      const context = createContext([{ content: 'Hello', id: 'user-1', role: 'user' }]);
      const result = await provider.process(context);

      expect(result.messages[0].content).toContain('Large Note');
      expect(result.messages[0].content).toContain('12k');
      expect(result.messages[0].content).not.toContain('empty');
    });

    it('should hide web-crawled docs from the index and surface the count', async () => {
      const provider = new AgentDocumentContextInjector({
        currentTime: new Date('2026-04-29T00:00:00.000Z'),
        documents: [
          {
            content: 'user note',
            filename: 'daily-brief.txt',
            id: '2af6eb88-8bdb-468f-887f-620baa394efa',
            loadPosition: 'before-first-user',
            loadRules: { rule: 'always' },
            policyLoad: 'progressive',
            sourceType: 'file',
            title: 'Daily Brief',
            updatedAt: new Date('2026-04-27T00:00:00.000Z'),
          },
          {
            content: 'gold price page',
            filename: 'gold-price-1.html',
            id: 'web-1',
            loadPosition: 'before-first-user',
            loadRules: { rule: 'always' },
            policyLoad: 'progressive',
            sourceType: 'web',
            title: 'Gold price',
          },
          {
            content: 'gold news',
            filename: 'gold-news.html',
            id: 'web-2',
            loadPosition: 'before-first-user',
            loadRules: { rule: 'always' },
            policyLoad: 'progressive',
            sourceType: 'web',
            title: 'Gold news',
          },
        ],
      });

      const context = createContext([{ content: 'Hello', id: 'user-1', role: 'user' }]);
      const result = await provider.process(context);

      expect(result.messages[0].content).toMatchInlineSnapshot(`
        "<agent_documents_index>
        1 user-created doc. Use readDocument(id) for full content.
        2 web-crawled docs hidden — call listDocuments(sourceType='web') to see them.

        TITLE        ID                                    SIZE  UPDATED
        Daily Brief  2af6eb88-8bdb-468f-887f-620baa394efa  9     2d ago
        </agent_documents_index>"
      `);
      expect(result.messages[0].content).not.toContain('Gold price');
      expect(result.messages[0].content).not.toContain('Gold news');
    });

    it('should collapse same-folder docs into a summary row and keep root docs flat', async () => {
      const provider = new AgentDocumentContextInjector({
        currentTime: new Date('2026-04-29T00:00:00.000Z'),
        documents: [
          {
            content: 'root note',
            filename: 'root.md',
            id: 'root-1',
            loadPosition: 'before-first-user',
            loadRules: { rule: 'always' },
            policyLoad: 'progressive',
            sourceType: 'file',
            title: 'Root note',
            updatedAt: new Date('2026-04-28T00:00:00.000Z'),
          },
          {
            content: 'a'.repeat(4300),
            filename: 'brief-1.md',
            folderTitle: 'dailyBrief',
            id: 'daily-1',
            loadPosition: 'before-first-user',
            loadRules: { rule: 'always' },
            parentId: 'folder-daily',
            policyLoad: 'progressive',
            sourceType: 'file',
            title: 'Brief 1',
            updatedAt: new Date('2026-04-27T00:00:00.000Z'),
          },
          {
            content: 'a'.repeat(20_000),
            filename: 'brief-2.md',
            folderTitle: 'dailyBrief',
            id: 'daily-2',
            loadPosition: 'before-first-user',
            loadRules: { rule: 'always' },
            parentId: 'folder-daily',
            policyLoad: 'progressive',
            sourceType: 'file',
            title: 'Brief 2',
            updatedAt: new Date('2026-04-25T00:00:00.000Z'),
          },
          {
            content: 'a'.repeat(12_000),
            filename: 'brief-3.md',
            folderTitle: 'dailyBrief',
            id: 'daily-3',
            loadPosition: 'before-first-user',
            loadRules: { rule: 'always' },
            parentId: 'folder-daily',
            policyLoad: 'progressive',
            sourceType: 'file',
            title: 'Brief 3',
            updatedAt: new Date('2026-04-26T00:00:00.000Z'),
          },
        ],
      });

      const context = createContext([{ content: 'Hello', id: 'user-1', role: 'user' }]);
      const result = await provider.process(context);

      expect(result.messages[0].content).toMatchInlineSnapshot(`
        "<agent_documents_index>
        4 user-created docs. Use readDocument(id) for full content.
        1 folder collapsed (📁) — call listDocuments(parentId=<id>) to list a folder's docs.

        TITLE      ID      SIZE  UPDATED
        Root note  root-1  9     1d ago

        📁 dailyBrief  folder-daily  3 docs, 4.3k–20k  2d ago
        </agent_documents_index>"
      `);
      // Individual folded doc ids are hidden — the model expands via listDocuments.
      expect(result.messages[0].content).not.toContain('daily-1');
      expect(result.messages[0].content).not.toContain('daily-2');
    });

    it('should keep a lone doc-in-folder flat instead of collapsing it', async () => {
      const provider = new AgentDocumentContextInjector({
        currentTime: new Date('2026-04-29T00:00:00.000Z'),
        documents: [
          {
            content: 'solo note',
            filename: 'solo.md',
            folderTitle: 'Archive',
            id: 'solo-1',
            loadPosition: 'before-first-user',
            loadRules: { rule: 'always' },
            parentId: 'folder-archive',
            policyLoad: 'progressive',
            sourceType: 'file',
            title: 'Solo',
            updatedAt: new Date('2026-04-27T00:00:00.000Z'),
          },
        ],
      });

      const context = createContext([{ content: 'Hello', id: 'user-1', role: 'user' }]);
      const result = await provider.process(context);

      const injected = result.messages[0].content;
      // Rendered as a normal flat row (id readable), not a 📁 fold.
      expect(injected).toContain('solo-1');
      expect(injected).not.toContain('📁');
      expect(injected).not.toContain('folder collapsed');
    });

    it('should render empty docs with size=empty so the LLM does not retry', async () => {
      const provider = new AgentDocumentContextInjector({
        currentTime: new Date('2026-04-29T00:00:00.000Z'),
        documents: [
          {
            content: '',
            filename: 'placeholder.md',
            id: 'd14dca54-7b38-44d5-9bdb-f3fed8c5f947',
            loadPosition: 'before-first-user',
            loadRules: { rule: 'always' },
            policyLoad: 'progressive',
            sourceType: 'file',
            title: '周报与平台对话分析',
            updatedAt: new Date('2026-04-16T00:00:00.000Z'),
          },
        ],
      });

      const context = createContext([{ content: 'Hello', id: 'user-1', role: 'user' }]);
      const result = await provider.process(context);

      expect(result.messages[0].content).toMatchInlineSnapshot(`
        "<agent_documents_index>
        1 user-created doc. Use readDocument(id) for full content.

        TITLE      ID                                    SIZE   UPDATED
        周报与平台对话分析  d14dca54-7b38-44d5-9bdb-f3fed8c5f947  empty  13d ago
        </agent_documents_index>"
      `);
    });

    it('should mix full-content and progressive documents', async () => {
      const provider = new AgentDocumentContextInjector({
        currentTime: new Date('2026-04-29T00:00:00.000Z'),
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
            filename: 'summary.md',
            id: 'doc-p',
            loadPosition: 'before-first-user',
            loadRules: { rule: 'always' },
            policyLoad: 'progressive',
            sourceType: 'file',
            title: 'Summary',
            updatedAt: new Date('2026-04-28T00:00:00.000Z'),
          },
        ],
      });

      const context = createContext([{ content: 'Hello', id: 'user-1', role: 'user' }]);
      const result = await provider.process(context);

      const injected = result.messages[0].content;
      expect(injected).toContain('Always-loaded full content');
      expect(injected).toContain('<agent_documents_index>');
      expect(injected).toContain('Summary');
      expect(injected).toContain('doc-p');
      expect(injected).not.toContain('Progressive content hidden');
    });

    // Regression: — `policyLoad: 'disabled'` rows were being routed
    // into the full-content bucket (the old `!== 'progressive'` filter), so
    // documents the user explicitly turned off still got inlined into the LLM
    // payload. The disabled row must show up in neither bucket.
    it('should drop disabled documents from both inline and progressive index', async () => {
      const provider = new AgentDocumentContextInjector({
        currentTime: new Date('2026-04-29T00:00:00.000Z'),
        documents: [
          {
            content: 'DISABLED skill body that must never leak',
            filename: 'SKILL.md',
            id: 'disabled-1',
            loadPosition: 'before-first-user',
            loadRules: { rule: 'always' },
            policyLoad: 'disabled',
            sourceType: 'agent',
            title: 'Disabled Skill',
            updatedAt: new Date('2026-04-27T00:00:00.000Z'),
          },
          {
            content: 'Always-loaded full content',
            filename: 'full.md',
            id: 'always-1',
            loadPosition: 'before-first-user',
            loadRules: { rule: 'always' },
            policyLoad: 'always',
          },
        ],
      });

      const context = createContext([{ content: 'Hello', id: 'user-1', role: 'user' }]);
      const result = await provider.process(context);

      const injected = result.messages[0].content;
      expect(injected).toContain('Always-loaded full content');
      expect(injected).not.toContain('DISABLED skill body that must never leak');
      expect(injected).not.toContain('disabled-1');
      expect(injected).not.toContain('Disabled Skill');
      expect(injected).not.toContain('<agent_documents_index>');
    });

    // Regression: combineDocuments switched to a strict `=== 'always'` inline
    // whitelist. `policyLoad` is optional on AgentContextDocument, and some
    // callers pass docs without it — those must default to progressive (shown
    // in the index, not silently dropped from BOTH buckets).
    it('routes documents with missing policyLoad into the progressive index', async () => {
      const provider = new AgentDocumentContextInjector({
        currentTime: new Date('2026-04-29T00:00:00.000Z'),
        documents: [
          {
            content: 'Body of a doc that forgot to set policyLoad',
            filename: 'setup.md',
            id: 'no-policy-1',
            loadPosition: 'before-first-user',
            loadRules: { rule: 'always' },
            sourceType: 'agent',
            title: 'Setup',
            updatedAt: new Date('2026-04-27T00:00:00.000Z'),
          },
        ],
      });

      const context = createContext([{ content: 'Hello', id: 'user-1', role: 'user' }]);
      const result = await provider.process(context);

      const injected = result.messages[0].content;
      // Surfaced via the index (title + id), not inlined as full content.
      expect(injected).toContain('<agent_documents_index>');
      expect(injected).toContain('Setup');
      expect(injected).toContain('no-policy-1');
      expect(injected).not.toContain('Body of a doc that forgot to set policyLoad');
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
            policyLoad: 'always',
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
            policyLoad: 'always',
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
            policyLoad: 'always',
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
            policyLoad: 'always',
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
            policyLoad: 'always',
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

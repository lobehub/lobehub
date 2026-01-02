import { describe, expect, it } from 'vitest';

import type { PipelineContext } from '../../types';
import { KnowledgeInjector } from '../KnowledgeInjector';

describe('KnowledgeInjector', () => {
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

  describe('basic injection', () => {
    it('should inject knowledge before the first user message', async () => {
      const provider = new KnowledgeInjector({
        fileContents: [{ content: 'File content here', fileId: 'file-1', filename: 'test.md' }],
        knowledgeBases: [],
      });

      const context = createContext([
        { content: 'System prompt', id: 'sys-1', role: 'system' },
        { content: 'Hello', id: 'user-1', role: 'user' },
      ]);

      const result = await provider.process(context);

      expect(result.messages).toHaveLength(3);
      expect(result.messages[0].role).toBe('system');
      expect(result.messages[1].role).toBe('user');
      expect(result.messages[1].meta?.systemInjection).toBe(true);
      expect(result.messages[1].content).toMatchSnapshot();
      expect(result.messages[2].content).toBe('Hello');
      expect(result.metadata.knowledgeInjected).toBe(true);
    });

    it('should skip injection when no files or knowledge bases', async () => {
      const provider = new KnowledgeInjector({
        fileContents: [],
        knowledgeBases: [],
      });

      const context = createContext([{ content: 'Hello', id: 'user-1', role: 'user' }]);

      const result = await provider.process(context);

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].content).toBe('Hello');
      expect(result.metadata.knowledgeInjected).toBeUndefined();
    });

    it('should skip injection when config is empty', async () => {
      const provider = new KnowledgeInjector({});

      const context = createContext([{ content: 'Hello', id: 'user-1', role: 'user' }]);

      const result = await provider.process(context);

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].content).toBe('Hello');
    });

    it('should skip injection when no user messages exist', async () => {
      const provider = new KnowledgeInjector({
        fileContents: [{ content: 'Content', fileId: 'file-1', filename: 'file.md' }],
      });

      const context = createContext([{ content: 'System prompt', id: 'sys-1', role: 'system' }]);

      const result = await provider.process(context);

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].role).toBe('system');
    });
  });

  describe('file contents', () => {
    it('should inject multiple file contents', async () => {
      const provider = new KnowledgeInjector({
        fileContents: [
          { content: 'Content of file 1', fileId: 'file-1', filename: 'file1.md' },
          { content: 'Content of file 2', fileId: 'file-2', filename: 'file2.ts' },
        ],
      });

      const context = createContext([{ content: 'Hello', id: 'user-1', role: 'user' }]);

      const result = await provider.process(context);

      expect(result.messages[0].content).toMatchSnapshot();
      expect(result.metadata.filesCount).toBe(2);
    });
  });

  describe('knowledge bases', () => {
    it('should inject knowledge bases', async () => {
      const provider = new KnowledgeInjector({
        knowledgeBases: [
          { description: 'Description 1', id: 'kb-1', name: 'KB 1' },
          { description: 'Description 2', id: 'kb-2', name: 'KB 2' },
        ],
      });

      const context = createContext([{ content: 'Hello', id: 'user-1', role: 'user' }]);

      const result = await provider.process(context);

      expect(result.messages[0].content).toMatchSnapshot();
      expect(result.metadata.knowledgeBasesCount).toBe(2);
    });
  });

  describe('mixed content', () => {
    it('should inject both files and knowledge bases', async () => {
      const provider = new KnowledgeInjector({
        fileContents: [{ content: 'File content', fileId: 'file-1', filename: 'readme.md' }],
        knowledgeBases: [{ description: 'API docs', id: 'kb-1', name: 'API Reference' }],
      });

      const context = createContext([{ content: 'Hello', id: 'user-1', role: 'user' }]);

      const result = await provider.process(context);

      expect(result.messages[0].content).toMatchSnapshot();
      expect(result.metadata.filesCount).toBe(1);
      expect(result.metadata.knowledgeBasesCount).toBe(1);
    });
  });

  describe('integration with BaseFirstUserContentProvider', () => {
    it('should append to existing system injection message', async () => {
      const provider = new KnowledgeInjector({
        fileContents: [{ content: 'File content', fileId: 'file-1', filename: 'test.md' }],
      });

      const context = createContext([
        { content: 'System prompt', id: 'sys-1', role: 'system' },
        {
          content: 'Existing injection content',
          id: 'inject-1',
          meta: { systemInjection: true },
          role: 'user',
        },
        { content: 'Hello', id: 'user-1', role: 'user' },
      ]);

      const result = await provider.process(context);

      expect(result.messages).toHaveLength(3);
      expect(result.messages[1].content).toMatchSnapshot();
    });

    it('should work when user message is first', async () => {
      const provider = new KnowledgeInjector({
        fileContents: [{ content: 'Content', fileId: 'file-1', filename: 'file.md' }],
      });

      const context = createContext([
        { content: 'Hello', id: 'user-1', role: 'user' },
        { content: 'Response', id: 'asst-1', role: 'assistant' },
      ]);

      const result = await provider.process(context);

      expect(result.messages).toHaveLength(3);
      expect(result.messages[0].meta?.systemInjection).toBe(true);
      expect(result.messages[0].content).toMatchSnapshot();
      expect(result.messages[1].content).toBe('Hello');
    });
  });

  describe('metadata', () => {
    it('should set correct metadata counts', async () => {
      const provider = new KnowledgeInjector({
        fileContents: [
          { content: 'Content 1', fileId: 'file-1', filename: 'file1.md' },
          { content: 'Content 2', fileId: 'file-2', filename: 'file2.md' },
          { content: 'Content 3', fileId: 'file-3', filename: 'file3.md' },
        ],
        knowledgeBases: [
          { description: 'KB 1', id: 'kb-1', name: 'KB1' },
          { description: 'KB 2', id: 'kb-2', name: 'KB2' },
        ],
      });

      const context = createContext([{ content: 'Hello', id: 'user-1', role: 'user' }]);

      const result = await provider.process(context);

      expect(result.metadata.knowledgeInjected).toBe(true);
      expect(result.metadata.filesCount).toBe(3);
      expect(result.metadata.knowledgeBasesCount).toBe(2);
    });

    it('should not set metadata when no content is injected', async () => {
      const provider = new KnowledgeInjector({
        fileContents: [],
        knowledgeBases: [],
      });

      const context = createContext([{ content: 'Hello', id: 'user-1', role: 'user' }]);

      const result = await provider.process(context);

      expect(result.metadata.knowledgeInjected).toBeUndefined();
      expect(result.metadata.filesCount).toBeUndefined();
      expect(result.metadata.knowledgeBasesCount).toBeUndefined();
    });
  });

  describe('edge cases', () => {
    it('should handle empty message array', async () => {
      const provider = new KnowledgeInjector({
        fileContents: [{ content: 'Content', fileId: 'file-1', filename: 'file.md' }],
      });

      const context = createContext([]);

      const result = await provider.process(context);

      expect(result.messages).toHaveLength(0);
    });

    it('should handle conversation with multiple user messages', async () => {
      const provider = new KnowledgeInjector({
        fileContents: [{ content: 'Content', fileId: 'file-1', filename: 'file.md' }],
      });

      const context = createContext([
        { content: 'First question', id: 'user-1', role: 'user' },
        { content: 'First response', id: 'asst-1', role: 'assistant' },
        { content: 'Second question', id: 'user-2', role: 'user' },
        { content: 'Second response', id: 'asst-2', role: 'assistant' },
      ]);

      const result = await provider.process(context);

      expect(result.messages).toHaveLength(5);
      // Injection should be before the first user message
      expect(result.messages[0].meta?.systemInjection).toBe(true);
      expect(result.messages[1].content).toBe('First question');
    });
  });
});

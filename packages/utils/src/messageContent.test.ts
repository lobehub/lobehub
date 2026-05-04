import type { UIChatMessage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { extractMessageContent } from './messageContent';

describe('extractMessageContent', () => {
  describe('standard messages', () => {
    it('extracts content from user message', () => {
      const message = { role: 'user', content: 'Hello' } as UIChatMessage;
      expect(extractMessageContent(message)).toBe('Hello');
    });

    it('extracts content from assistant message with reasoning', () => {
      const message = {
        role: 'assistant',
        content: 'Response',
        reasoning: { content: 'Thinking...' },
      } as UIChatMessage;
      expect(extractMessageContent(message)).toBe('ResponseThinking...');
    });

    it('includes RAG query content', () => {
      const message = {
        role: 'user',
        content: 'Question',
        ragQuery: 'search query',
        ragRawQuery: 'raw search query',
      } as UIChatMessage;
      expect(extractMessageContent(message)).toBe('Questionsearch queryraw search query');
    });

    it('includes search/grounding content', () => {
      const message = {
        role: 'assistant',
        content: 'Response',
        search: {
          searchQueries: ['query1', 'query2'],
          citations: [{ title: 'Source A' }, { title: 'Source B' }],
        },
      } as UIChatMessage;
      expect(extractMessageContent(message)).toBe('Responsequery1query2Source ASource B');
    });

    it('returns empty string for message without content', () => {
      const message = { role: 'user' } as UIChatMessage;
      expect(extractMessageContent(message)).toBe('');
    });
  });

  describe('assistantGroup', () => {
    it('extracts content from children array', () => {
      const message = {
        role: 'assistantGroup',
        content: '',
        children: [
          { id: '1', content: 'First response' },
          { id: '2', content: 'Second response' },
        ],
      } as UIChatMessage;
      expect(extractMessageContent(message)).toBe('First responseSecond response');
    });

    it('includes tool results from children', () => {
      const message = {
        role: 'assistantGroup',
        content: '',
        children: [
          {
            id: '1',
            content: 'Response',
            tools: [
              {
                arguments: '{"city":"San Francisco"}',
                result: { content: 'Tool result' },
              },
            ],
          },
        ],
      } as UIChatMessage;
      expect(extractMessageContent(message)).toBe('Response{"city":"San Francisco"}Tool result');
    });

    it('includes reasoning content from children', () => {
      const message = {
        role: 'assistantGroup',
        content: '',
        children: [
          {
            id: '1',
            content: 'Response',
            reasoning: { content: 'Thought process' },
          },
        ],
      } as UIChatMessage;
      expect(extractMessageContent(message)).toBe('ResponseThought process');
    });
  });

  describe('supervisor', () => {
    it('extracts content from children array', () => {
      const message = {
        role: 'supervisor',
        content: '',
        children: [{ id: '1', content: 'Supervisor response' }],
      } as UIChatMessage;
      expect(extractMessageContent(message)).toBe('Supervisor response');
    });
  });

  describe('tasks', () => {
    it('extracts content from tasks array recursively', () => {
      const message = {
        role: 'tasks',
        content: '',
        tasks: [
          { id: '1', role: 'task', content: 'Task 1 result' },
          { id: '2', role: 'task', content: 'Task 2 result' },
        ],
      } as UIChatMessage;
      expect(extractMessageContent(message)).toBe('Task 1 resultTask 2 result');
    });

    it('extracts content from groupTasks role', () => {
      const message = {
        role: 'groupTasks',
        content: '',
        tasks: [{ id: '1', role: 'task', content: 'Task result' }],
      } as UIChatMessage;
      expect(extractMessageContent(message)).toBe('Task result');
    });
  });

  describe('agentCouncil', () => {
    it('extracts content from members array recursively', () => {
      const message = {
        role: 'agentCouncil',
        content: '',
        members: [
          { id: '1', role: 'assistant', content: 'Agent A says' },
          { id: '2', role: 'assistant', content: 'Agent B says' },
        ],
      } as UIChatMessage;
      expect(extractMessageContent(message)).toBe('Agent A saysAgent B says');
    });

    it('handles nested assistantGroup in members', () => {
      const message = {
        role: 'agentCouncil',
        content: '',
        members: [
          {
            id: '1',
            role: 'assistantGroup',
            content: '',
            children: [{ id: '2', content: 'Nested content' }],
          },
        ],
      } as UIChatMessage;
      expect(extractMessageContent(message)).toBe('Nested content');
    });
  });

  describe('compare', () => {
    it('extracts content from columns array', () => {
      const message = {
        id: '1',
        role: 'compare',
        content: '',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        columns: [
          [{ id: '1', role: 'assistant', content: 'Column A' }],
          [{ id: '2', role: 'assistant', content: 'Column B' }],
        ],
      } as UIChatMessage;
      expect(extractMessageContent(message)).toBe('Column AColumn B');
    });

    it('handles compareGroup role for compatibility', () => {
      const message = {
        id: '1',
        role: 'compareGroup',
        content: '',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        columns: [
          [{ id: '1', role: 'assistant', content: 'Response A' }],
          [{ id: '2', role: 'assistant', content: 'Response B' }],
        ],
      } as UIChatMessage;
      expect(extractMessageContent(message)).toBe('Response AResponse B');
    });
  });

  describe('compressedGroup', () => {
    it('extracts summary from content', () => {
      const message = {
        role: 'compressedGroup',
        content: 'Summary of conversation',
      } as UIChatMessage;
      expect(extractMessageContent(message)).toBe('Summary of conversation');
    });

    it('ignores compressedMessages (UI metadata not sent to model)', () => {
      const message = {
        role: 'compressedGroup',
        content: 'Summary: ',
        compressedMessages: [
          { id: '1', role: 'user', content: 'Question' },
          { id: '2', role: 'assistant', content: 'Answer' },
        ],
      } as UIChatMessage;
      // Only content is counted; compressedMessages are UI snapshot metadata
      expect(extractMessageContent(message)).toBe('Summary: ');
    });

    it('ignores pinnedMessages (UI metadata not sent to model)', () => {
      const message = {
        role: 'compressedGroup',
        content: 'Summary',
        pinnedMessages: [
          { id: '1', content: 'Important message' },
          { id: '2', content: 'Follow-up' },
        ],
      } as UIChatMessage;
      // Only content is counted; pinnedMessages are UI snapshot metadata
      expect(extractMessageContent(message)).toBe('Summary');
    });
  });
});

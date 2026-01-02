import { describe, expect, it } from 'vitest';

import type { IdNode, Message } from '../../types';
import { MessageCollector } from '../MessageCollector';

describe('MessageCollector', () => {
  describe('collectGroupMembers', () => {
    it('should collect messages with matching groupId', () => {
      const messageMap = new Map<string, Message>();
      const childrenMap = new Map<string | null, string[]>();
      const collector = new MessageCollector(messageMap, childrenMap);

      const messages: Message[] = [
        {
          content: '1',
          createdAt: 0,
          groupId: 'group-1',
          id: 'msg-1',
          role: 'assistant',
          updatedAt: 0,
        },
        {
          content: '2',
          createdAt: 0,
          groupId: 'group-1',
          id: 'msg-2',
          role: 'assistant',
          updatedAt: 0,
        },
        {
          content: '3',
          createdAt: 0,
          groupId: 'group-2',
          id: 'msg-3',
          role: 'assistant',
          updatedAt: 0,
        },
      ];

      const result = collector.collectGroupMembers('group-1', messages);

      expect(result).toHaveLength(2);
      expect(result.map((m) => m.id)).toEqual(['msg-1', 'msg-2']);
    });
  });

  describe('collectToolMessages', () => {
    it('should collect tool messages matching assistant tool call IDs', () => {
      const messageMap = new Map<string, Message>();
      const childrenMap = new Map<string | null, string[]>();
      const collector = new MessageCollector(messageMap, childrenMap);

      const assistant: Message = {
        content: 'test',
        createdAt: 0,
        id: 'msg-1',
        role: 'assistant',
        tools: [
          { apiName: 'tool1', arguments: '{}', id: 'tool-1', identifier: 'test', type: 'default' },
          { apiName: 'tool2', arguments: '{}', id: 'tool-2', identifier: 'test', type: 'default' },
        ],
        updatedAt: 0,
      };

      const messages: Message[] = [
        {
          content: 'result1',
          createdAt: 0,
          id: 'msg-2',
          parentId: 'msg-1',
          role: 'tool',
          tool_call_id: 'tool-1',
          updatedAt: 0,
        },
        {
          content: 'result2',
          createdAt: 0,
          id: 'msg-3',
          parentId: 'msg-1',
          role: 'tool',
          tool_call_id: 'tool-2',
          updatedAt: 0,
        },
        {
          content: 'other',
          createdAt: 0,
          id: 'msg-4',
          parentId: 'msg-1',
          role: 'tool',
          tool_call_id: 'tool-3',
          updatedAt: 0,
        },
      ];

      const result = collector.collectToolMessages(assistant, messages);

      expect(result).toHaveLength(2);
      expect(result.map((m) => m.id)).toEqual(['msg-2', 'msg-3']);
    });
  });

  describe('findLastNodeInAssistantGroup', () => {
    it('should return the node itself if no tool children', () => {
      const messageMap = new Map<string, Message>();
      const childrenMap = new Map<string | null, string[]>();
      const collector = new MessageCollector(messageMap, childrenMap);

      const idNode: IdNode = {
        children: [],
        id: 'msg-1',
      };

      const result = collector.findLastNodeInAssistantGroup(idNode);

      expect(result).toEqual(idNode);
    });

    it('should return last tool node if no assistant children', () => {
      const messageMap = new Map<string, Message>([
        [
          'msg-1',
          {
            content: 'test',
            createdAt: 0,
            id: 'msg-1',
            role: 'assistant',
            updatedAt: 0,
          },
        ],
        [
          'tool-1',
          {
            content: 'result',
            createdAt: 0,
            id: 'tool-1',
            parentId: 'msg-1',
            role: 'tool',
            updatedAt: 0,
          },
        ],
      ]);
      const childrenMap = new Map<string | null, string[]>();
      const collector = new MessageCollector(messageMap, childrenMap);

      const idNode: IdNode = {
        children: [{ children: [], id: 'tool-1' }],
        id: 'msg-1',
      };

      const result = collector.findLastNodeInAssistantGroup(idNode);

      expect(result?.id).toBe('tool-1');
    });

    it('should follow assistant chain recursively', () => {
      const messageMap = new Map<string, Message>([
        [
          'msg-1',
          {
            content: 'test1',
            createdAt: 0,
            id: 'msg-1',
            role: 'assistant',
            updatedAt: 0,
          },
        ],
        [
          'tool-1',
          {
            content: 'result1',
            createdAt: 0,
            id: 'tool-1',
            parentId: 'msg-1',
            role: 'tool',
            updatedAt: 0,
          },
        ],
        [
          'msg-2',
          {
            content: 'test2',
            createdAt: 0,
            id: 'msg-2',
            parentId: 'tool-1',
            role: 'assistant',
            updatedAt: 0,
          },
        ],
      ]);
      const childrenMap = new Map<string | null, string[]>();
      const collector = new MessageCollector(messageMap, childrenMap);

      const idNode: IdNode = {
        children: [
          {
            children: [{ children: [], id: 'msg-2' }],
            id: 'tool-1',
          },
        ],
        id: 'msg-1',
      };

      const result = collector.findLastNodeInAssistantGroup(idNode);

      expect(result?.id).toBe('msg-2');
    });
  });
});

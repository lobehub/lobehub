import { describe, expect, it } from 'vitest';

import { buildHelperMaps } from '../indexing';
import type { Message, MessageGroupMetadata } from '../types';

const createMessage = (
  id: string,
  role: Message['role'],
  content: string,
  createdAt: number,
  updatedAt: number,
): Message => ({
  content,
  createdAt,
  id,
  role,
  updatedAt,
});

const createChildMessage = (
  id: string,
  parentId: string,
  role: Message['role'],
  content: string,
  createdAt: number,
  updatedAt: number,
): Message => ({
  content,
  createdAt,
  id,
  parentId,
  role,
  updatedAt,
});

describe('buildHelperMaps', () => {
  describe('messageMap', () => {
    it('should build messageMap for O(1) access', () => {
      const messages: Message[] = [
        createMessage('msg-1', 'user', 'Hello', 1000, 1000),
        createChildMessage('msg-2', 'msg-1', 'assistant', 'Hi there', 2000, 2000),
      ];

      const result = buildHelperMaps(messages);

      expect(result.messageMap.size).toBe(2);
      expect(result.messageMap.get('msg-1')).toEqual(messages[0]);
      expect(result.messageMap.get('msg-2')).toEqual(messages[1]);
    });

    it('should handle empty messages array', () => {
      const result = buildHelperMaps([]);

      expect(result.messageMap.size).toBe(0);
    });

    it('should handle single message', () => {
      const messages: Message[] = [createMessage('msg-1', 'user', 'Single message', 1000, 1000)];

      const result = buildHelperMaps(messages);

      expect(result.messageMap.size).toBe(1);
      expect(result.messageMap.get('msg-1')).toEqual(messages[0]);
    });
  });

  describe('childrenMap', () => {
    it('should build childrenMap for parent-child relationships', () => {
      const messages: Message[] = [
        createMessage('msg-1', 'user', 'Root', 1000, 1000),
        createChildMessage('msg-2', 'msg-1', 'assistant', 'Child 1', 2000, 2000),
        createChildMessage('msg-3', 'msg-1', 'assistant', 'Child 2', 3000, 3000),
      ];

      const result = buildHelperMaps(messages);

      expect(result.childrenMap.get(null)).toEqual(['msg-1']);
      expect(result.childrenMap.get('msg-1')).toEqual(['msg-2', 'msg-3']);
    });

    it('should handle messages with no parent (root messages)', () => {
      const messages: Message[] = [
        createMessage('msg-1', 'user', 'Root 1', 1000, 1000),
        createMessage('msg-2', 'user', 'Root 2', 2000, 2000),
      ];

      const result = buildHelperMaps(messages);

      expect(result.childrenMap.get(null)).toEqual(['msg-1', 'msg-2']);
    });

    it('should handle deeply nested parent-child relationships', () => {
      const messages: Message[] = [
        createMessage('msg-1', 'user', 'Level 0', 1000, 1000),
        createChildMessage('msg-2', 'msg-1', 'assistant', 'Level 1', 2000, 2000),
        createChildMessage('msg-3', 'msg-2', 'user', 'Level 2', 3000, 3000),
        createChildMessage('msg-4', 'msg-3', 'assistant', 'Level 3', 4000, 4000),
      ];

      const result = buildHelperMaps(messages);

      expect(result.childrenMap.get(null)).toEqual(['msg-1']);
      expect(result.childrenMap.get('msg-1')).toEqual(['msg-2']);
      expect(result.childrenMap.get('msg-2')).toEqual(['msg-3']);
      expect(result.childrenMap.get('msg-3')).toEqual(['msg-4']);
    });

    it('should handle branching conversations', () => {
      const messages: Message[] = [
        createMessage('msg-1', 'user', 'Root', 1000, 1000),
        createChildMessage('msg-2', 'msg-1', 'assistant', 'Branch 1', 2000, 2000),
        createChildMessage('msg-3', 'msg-1', 'assistant', 'Branch 2', 3000, 3000),
        createChildMessage('msg-4', 'msg-2', 'user', 'Sub-branch 1', 4000, 4000),
        createChildMessage('msg-5', 'msg-2', 'user', 'Sub-branch 2', 5000, 5000),
      ];

      const result = buildHelperMaps(messages);

      expect(result.childrenMap.get(null)).toEqual(['msg-1']);
      expect(result.childrenMap.get('msg-1')).toEqual(['msg-2', 'msg-3']);
      expect(result.childrenMap.get('msg-2')).toEqual(['msg-4', 'msg-5']);
    });
  });

  describe('threadMap', () => {
    it('should build threadMap for messages with threadId', () => {
      const messages: Message[] = [
        createMessage('msg-1', 'user', 'Main message', 1000, 1000),
        {
          content: 'Thread message 1',
          createdAt: 2000,
          id: 'msg-2',
          parentId: 'msg-1',
          role: 'assistant',
          threadId: 'thread-1',
          updatedAt: 2000,
        },
        {
          content: 'Thread message 2',
          createdAt: 3000,
          id: 'msg-3',
          parentId: 'msg-2',
          role: 'user',
          threadId: 'thread-1',
          updatedAt: 3000,
        },
      ];

      const result = buildHelperMaps(messages);

      expect(result.threadMap.size).toBe(1);
      expect(result.threadMap.get('thread-1')).toHaveLength(2);
      expect(result.threadMap.get('thread-1')).toEqual([messages[1], messages[2]]);
    });

    it('should handle multiple threads', () => {
      const messages: Message[] = [
        {
          content: 'Thread 1 - msg 1',
          createdAt: 1000,
          id: 'msg-1',
          role: 'user',
          threadId: 'thread-1',
          updatedAt: 1000,
        },
        {
          content: 'Thread 1 - msg 2',
          createdAt: 2000,
          id: 'msg-2',
          role: 'assistant',
          threadId: 'thread-1',
          updatedAt: 2000,
        },
        {
          content: 'Thread 2 - msg 1',
          createdAt: 3000,
          id: 'msg-3',
          role: 'user',
          threadId: 'thread-2',
          updatedAt: 3000,
        },
      ];

      const result = buildHelperMaps(messages);

      expect(result.threadMap.size).toBe(2);
      expect(result.threadMap.get('thread-1')).toEqual([messages[0], messages[1]]);
      expect(result.threadMap.get('thread-2')).toEqual([messages[2]]);
    });

    it('should not include messages without threadId in threadMap', () => {
      const messages: Message[] = [
        createMessage('msg-1', 'user', 'No thread', 1000, 1000),
        {
          content: 'With thread',
          createdAt: 2000,
          id: 'msg-2',
          role: 'assistant',
          threadId: 'thread-1',
          updatedAt: 2000,
        },
      ];

      const result = buildHelperMaps(messages);

      expect(result.threadMap.size).toBe(1);
      expect(result.threadMap.get('thread-1')).toEqual([messages[1]]);
    });

    it('should handle empty threadMap when no messages have threadId', () => {
      const messages: Message[] = [
        createMessage('msg-1', 'user', 'Message 1', 1000, 1000),
        createMessage('msg-2', 'assistant', 'Message 2', 2000, 2000),
      ];

      const result = buildHelperMaps(messages);

      expect(result.threadMap.size).toBe(0);
    });
  });

  describe('messageGroupMap', () => {
    it('should build messageGroupMap from provided metadata', () => {
      const messages: Message[] = [createMessage('msg-1', 'user', 'Message', 1000, 1000)];

      const messageGroups: MessageGroupMetadata[] = [
        {
          id: 'group-1',
          mode: 'compare',
        },
        {
          id: 'group-2',
          mode: 'summary',
        },
      ];

      const result = buildHelperMaps(messages, messageGroups);

      expect(result.messageGroupMap.size).toBe(2);
      expect(result.messageGroupMap.get('group-1')).toEqual(messageGroups[0]);
      expect(result.messageGroupMap.get('group-2')).toEqual(messageGroups[1]);
    });

    it('should handle empty messageGroupMap when no metadata provided', () => {
      const messages: Message[] = [createMessage('msg-1', 'user', 'Message', 1000, 1000)];

      const result = buildHelperMaps(messages);

      expect(result.messageGroupMap.size).toBe(0);
    });

    it('should handle empty messageGroupMap when empty array provided', () => {
      const messages: Message[] = [createMessage('msg-1', 'user', 'Message', 1000, 1000)];

      const result = buildHelperMaps(messages, []);

      expect(result.messageGroupMap.size).toBe(0);
    });
  });

  describe('compressedGroup lastMessageId redirection', () => {
    it('should redirect parentId to compressedGroup when pointing to lastMessageId', () => {
      // This tests the scenario after compression:
      // 1. compressedGroup contains messages with lastMessageId='msg-3'
      // 2. New assistant message is created with parentId='msg-3'
      // 3. msg-3 is hidden inside the compressedGroup, not in the message list
      // 4. childrenMap should redirect: assistant becomes child of compressedGroup
      const messages: Message[] = [
        {
          content: 'Summary of conversation',
          createdAt: 1000,
          id: 'comp-group-1',
          lastMessageId: 'msg-3', // Last compressed message (hidden)
          pinnedMessages: [],
          role: 'compressedGroup',
          updatedAt: 1000,
        } as any,
        {
          content: 'New assistant response after compression',
          createdAt: 2000,
          id: 'msg-new',
          parentId: 'msg-3', // Points to compressed message (not in list!)
          role: 'assistant',
          updatedAt: 2000,
        },
      ];

      const result = buildHelperMaps(messages);

      // Without redirection: childrenMap.get('msg-3') = ['msg-new']
      // With redirection: childrenMap.get('comp-group-1') = ['msg-new']
      expect(result.childrenMap.get('comp-group-1')).toEqual(['msg-new']);
      expect(result.childrenMap.get('msg-3')).toBeUndefined();
    });

    it('should not redirect when parentId is a normal message', () => {
      const messages: Message[] = [
        {
          content: 'Summary',
          createdAt: 1000,
          id: 'comp-group-1',
          lastMessageId: 'msg-3',
          pinnedMessages: [],
          role: 'compressedGroup',
          updatedAt: 1000,
        } as any,
        createMessage('msg-4', 'user', 'User message', 2000, 2000),
        {
          content: 'Response to user',
          createdAt: 3000,
          id: 'msg-5',
          parentId: 'msg-4', // Normal parentId, should not redirect
          role: 'assistant',
          updatedAt: 3000,
        },
      ];

      const result = buildHelperMaps(messages);

      // msg-5 should be child of msg-4, not redirected
      expect(result.childrenMap.get('msg-4')).toEqual(['msg-5']);
    });

    it('should handle multiple compressedGroups with different lastMessageIds', () => {
      const messages: Message[] = [
        {
          content: 'First summary',
          createdAt: 1000,
          id: 'comp-group-1',
          lastMessageId: 'msg-a',
          pinnedMessages: [],
          role: 'compressedGroup',
          updatedAt: 1000,
        } as any,
        {
          content: 'Second summary',
          createdAt: 2000,
          id: 'comp-group-2',
          lastMessageId: 'msg-b',
          pinnedMessages: [],
          role: 'compressedGroup',
          updatedAt: 2000,
        } as any,
        createChildMessage('msg-new-1', 'msg-a', 'user', 'Child of first group', 3000, 3000),
        createChildMessage('msg-new-2', 'msg-b', 'assistant', 'Child of second group', 4000, 4000),
      ];

      const result = buildHelperMaps(messages);

      expect(result.childrenMap.get('comp-group-1')).toEqual(['msg-new-1']);
      expect(result.childrenMap.get('comp-group-2')).toEqual(['msg-new-2']);
    });

    it('should resolve lastMessageId from compressedMessages recursively', () => {
      // Data provenance:
      // - The nested `compressedMessages` shape comes from real frontend chat exports
      //   after context compression, where the visible compressedGroup keeps hidden
      //   user/assistant history inside display-only arrays.
      // - This represents the current synchronous chat path rather than eval tasks.
      const messages: Message[] = [
        {
          compressedMessages: [
            {
              id: 'msg-hidden-1',
              role: 'user',
            },
            {
              id: 'msg-hidden-2',
              role: 'assistant',
            },
          ],
          content: 'Compressed history',
          createdAt: 1000,
          id: 'comp-group-1',
          pinnedMessages: [],
          role: 'compressedGroup',
          updatedAt: 1000,
        } as any,
        createChildMessage(
          'msg-new',
          'msg-hidden-2',
          'assistant',
          'Follow-up after compression',
          2000,
          2000,
        ),
      ];

      const result = buildHelperMaps(messages);

      expect(result.childrenMap.get('comp-group-1')).toEqual(['msg-new']);
      expect(result.childrenMap.get('msg-hidden-2')).toBeUndefined();
    });

    it('should resolve lastMessageId from assistant children tools result', () => {
      // Data provenance:
      // - The nested assistant child with `tools[].result_msg_id` is abstracted from the
      //   real eval/compression export we inspected through `lh eval message list`.
      // - In that async eval flow, the compressed history contains assistant/tool chains
      //   instead of only plain lastMessageId markers.
      // - This represents the eval side of the system: long-running async task/search chains.
      const messages: Message[] = [
        {
          children: [
            {
              content: 'Search for clues',
              id: 'msg-assistant-1',
              tools: [
                {
                  id: 'tool-call-1',
                  result_msg_id: 'msg-tool-result-1',
                },
              ],
            },
          ],
          content: '',
          createdAt: 1000,
          id: 'comp-group-1',
          pinnedMessages: [],
          role: 'compressedGroup',
          updatedAt: 1000,
        } as any,
        createChildMessage(
          'msg-new',
          'msg-tool-result-1',
          'assistant',
          'Continue searching',
          2000,
          2000,
        ),
      ];

      const result = buildHelperMaps(messages);

      expect(result.childrenMap.get('comp-group-1')).toEqual(['msg-new']);
      expect(result.childrenMap.get('msg-tool-result-1')).toBeUndefined();
    });
  });

  describe('integration scenarios', () => {
    it('should build all maps correctly in complex conversation', () => {
      const messages: Message[] = [
        createMessage('msg-1', 'user', 'Root message', 1000, 1000),
        {
          content: 'Assistant response',
          createdAt: 2000,
          groupId: 'group-1',
          id: 'msg-2',
          parentId: 'msg-1',
          role: 'assistant',
          updatedAt: 2000,
        },
        {
          content: 'Thread message',
          createdAt: 3000,
          id: 'msg-3',
          parentId: 'msg-2',
          role: 'user',
          threadId: 'thread-1',
          updatedAt: 3000,
        },
        createChildMessage('msg-4', 'msg-1', 'assistant', 'Branch message', 4000, 4000),
      ];

      const messageGroups: MessageGroupMetadata[] = [
        {
          id: 'group-1',
          mode: 'compare',
        },
      ];

      const result = buildHelperMaps(messages, messageGroups);

      // Verify messageMap
      expect(result.messageMap.size).toBe(4);

      // Verify childrenMap
      expect(result.childrenMap.get(null)).toEqual(['msg-1']);
      expect(result.childrenMap.get('msg-1')).toEqual(['msg-2', 'msg-4']);
      expect(result.childrenMap.get('msg-2')).toEqual(['msg-3']);

      // Verify threadMap
      expect(result.threadMap.size).toBe(1);
      expect(result.threadMap.get('thread-1')).toEqual([messages[2]]);

      // Verify messageGroupMap
      expect(result.messageGroupMap.size).toBe(1);
      expect(result.messageGroupMap.get('group-1')).toEqual(messageGroups[0]);
    });

    it('should handle large number of messages efficiently', () => {
      const messages: Message[] = Array.from({ length: 1000 }, (_, i) => ({
        content: `Message ${i}`,
        createdAt: i,
        id: `msg-${i}`,
        parentId: i > 0 ? `msg-${i - 1}` : undefined,
        role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
        updatedAt: i,
      }));

      const startTime = performance.now();
      const result = buildHelperMaps(messages);
      const endTime = performance.now();

      const executionTime = endTime - startTime;

      expect(result.messageMap.size).toBe(1000);
      expect(result.childrenMap.size).toBe(1000);
      expect(executionTime).toBeLessThan(50); // Should be fast
    });
  });
});

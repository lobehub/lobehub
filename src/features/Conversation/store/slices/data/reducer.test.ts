import { type ChatToolPayload, type UIChatMessage } from '@lobechat/types';
import { beforeEach, describe, expect, it } from 'vitest';

import { type MessageDispatch } from './reducer';
import { messagesReducer } from './reducer';

describe('messagesReducer', () => {
  let initialState: UIChatMessage[];

  beforeEach(() => {
    initialState = [
      {
        id: 'message1',
        content: 'Hello World',
        createdAt: 1629264000000,
        updatedAt: 1629264000000,
        role: 'user',
      },
      {
        id: 'message2',
        content: 'How are you?',
        createdAt: 1629264001000,
        updatedAt: 1629264001000,
        role: 'assistant',
        tools: [
          { identifier: 'tool1', apiName: 'calculator', id: 'abc', type: 'default', arguments: '' },
        ],
      },
    ];
  });

  describe('updateMessage', () => {
    it('should update the specified message with the provided value', () => {
      const payload: MessageDispatch = {
        type: 'updateMessage',
        id: 'message1',
        value: { content: 'Updated Message' },
      };

      const newState = messagesReducer(initialState, payload);

      expect(newState[0]).toBeDefined();
      expect(newState[0].content).toBe('Updated Message');
      expect(newState[0].updatedAt).toBeGreaterThan(initialState[0].updatedAt);
    });

    it('should not modify the state if the specified message does not exist', () => {
      const payload: MessageDispatch = {
        type: 'updateMessage',
        id: 'nonexistentMessage',
        value: { content: 'Updated Message' },
      };

      const newState = messagesReducer(initialState, payload);

      expect(newState).toBe(initialState);
    });
  });

  describe('unimplemented type', () => {
    it('should throw an error when an unimplemented type is provided', () => {
      // @ts-ignore
      const payload: MessageDispatch = { type: 'unimplementedType' };

      expect(() => messagesReducer(initialState, payload)).toThrowError(
        '未实现的 dispatch type，请检查 reducer',
      );
    });
  });

  describe('updateMessageExtra', () => {
    it('should update the extra field of a message', () => {
      const payload: MessageDispatch = {
        type: 'updateMessageExtra',
        id: 'message1',
        key: 'testKey',
        value: 'testValue',
      };

      const newState = messagesReducer(initialState, payload);

      expect(newState[0].extra).toEqual({ testKey: 'testValue' });
      expect(newState[0].updatedAt).toBeGreaterThan(initialState[0].updatedAt);
    });

    it('should update the extra field of a message if extra exist', () => {
      const stateWithExtra: UIChatMessage[] = [
        ...initialState,
        {
          id: 'data',
          content: 'Hello World',
          createdAt: 1629264000000,
          updatedAt: 1629264000000,
          role: 'user',
          extra: { abc: '1' },
        } as UIChatMessage,
      ];

      const payload: MessageDispatch = {
        type: 'updateMessageExtra',
        id: 'data',
        key: 'abc',
        value: '2',
      };

      const newState = messagesReducer(stateWithExtra, payload);

      const dataMsg = newState.find((m) => m.id === 'data');
      expect(dataMsg?.extra).toEqual({ abc: '2' });
      expect(dataMsg?.updatedAt).toBeGreaterThan(1629264000000);
    });

    it('should not modify state if message is not found', () => {
      const payload: MessageDispatch = {
        type: 'updateMessageExtra',
        id: 'nonexistent',
        key: 'testKey',
        value: 'testValue',
      };

      const newState = messagesReducer(initialState, payload);
      expect(newState).toBe(initialState);
    });
  });

  describe('updateMessageMetadata', () => {
    it('should merge update the metadata field of a message', () => {
      const payload: MessageDispatch = {
        type: 'updateMessageMetadata',
        id: 'message1',
        value: { activeBranchIndex: 1 },
      };

      const newState = messagesReducer(initialState, payload);

      expect(newState[0].metadata).toEqual({ activeBranchIndex: 1 });
      expect(newState[0].updatedAt).toBeGreaterThan(initialState[0].updatedAt);
    });

    it('should merge update the metadata field if metadata already exists', () => {
      const stateWithMetadata: UIChatMessage[] = [
        {
          ...initialState[0],
          metadata: { activeBranchIndex: 0 },
        },
        initialState[1],
      ];

      const payload: MessageDispatch = {
        type: 'updateMessageMetadata',
        id: 'message1',
        value: { activeBranchIndex: 2 },
      };

      const newState = messagesReducer(stateWithMetadata, payload);

      expect(newState[0].metadata).toEqual({ activeBranchIndex: 2 });
      expect(newState[0].updatedAt).toBeGreaterThan(stateWithMetadata[0].updatedAt);
    });

    it('should not modify state if message is not found', () => {
      const payload: MessageDispatch = {
        type: 'updateMessageMetadata',
        id: 'nonexistent',
        value: { activeBranchIndex: 1 },
      };

      const newState = messagesReducer(initialState, payload);
      expect(newState).toBe(initialState);
    });
  });

  describe('updatePluginState', () => {
    it('should update the plugin state of a message', () => {
      const payload: MessageDispatch = {
        type: 'updatePluginState',
        id: 'message1',
        key: 'pluginKey',
        value: 'pluginValue',
      };

      const newState = messagesReducer(initialState, payload);

      expect(newState[0].pluginState).toEqual({ pluginKey: 'pluginValue' });
      expect(newState[0].updatedAt).toBeGreaterThan(initialState[0].updatedAt);
    });

    it('should not modify state if message is not found', () => {
      const payload: MessageDispatch = {
        type: 'updatePluginState',
        id: 'nonexistent',
        key: 'pluginKey',
        value: 'pluginValue',
      };

      const newState = messagesReducer(initialState, payload);
      expect(newState).toBe(initialState);
    });

    it('should not modify state if new plugin state is equal to old state', () => {
      const stateWithPluginState: UIChatMessage[] = [
        {
          ...initialState[0],
          pluginState: { existingKey: 'existingValue' },
        },
        initialState[1],
      ];

      const payload: MessageDispatch = {
        type: 'updatePluginState',
        id: 'message1',
        key: 'existingKey',
        value: 'existingValue',
      };

      const newState = messagesReducer(stateWithPluginState, payload);
      expect(newState).toBe(stateWithPluginState);
    });
  });

  describe('updateMessagePlugin', () => {
    it('should update the plugin of a tool message', () => {
      const stateWithToolMessage: UIChatMessage[] = [
        ...initialState,
        {
          id: 'toolMessage',
          role: 'tool',
          content: 'Tool content',
          createdAt: 1629264000000,
          updatedAt: 1629264000000,
          plugin: {
            identifier: 'tool1',
            apiName: 'calculator',
            type: 'default',
            arguments: '',
          },
          tool_call_id: 'abc',
        } as UIChatMessage,
      ];

      const payload: MessageDispatch = {
        type: 'updateMessagePlugin',
        id: 'toolMessage',
        value: { identifier: 'newPlugin' },
      };

      const newState = messagesReducer(stateWithToolMessage, payload);

      const toolMsg = newState.find((m) => m.id === 'toolMessage');
      expect(toolMsg?.plugin).toEqual({
        apiName: 'calculator',
        arguments: '',
        identifier: 'newPlugin',
        type: 'default',
      });
      expect(toolMsg?.updatedAt).toBeGreaterThan(1629264000000);
    });

    it('should not modify state if message is not found or not a tool message', () => {
      const payload: MessageDispatch = {
        type: 'updateMessagePlugin',
        id: 'message1', // This is a user message, not a tool message
        value: { identifier: 'newPlugin' },
      };

      const newState = messagesReducer(initialState, payload);
      expect(newState).toBe(initialState);
    });
  });

  describe('updateMessageTools', () => {
    it('should update a specific tool in an assistant message', () => {
      const payload: MessageDispatch = {
        type: 'updateMessageTools',
        id: 'message2',
        tool_call_id: 'abc',
        value: { apiName: 'updatedCalculator' },
      };

      const newState = messagesReducer(initialState, payload);

      expect(newState[1].tools?.[0]).toEqual({
        apiName: 'updatedCalculator',
        arguments: '',
        id: 'abc',
        identifier: 'tool1',
        type: 'default',
      });
      expect(newState[1].updatedAt).toBeGreaterThan(initialState[1].updatedAt);
    });

    it('should not modify state if message is not found or not an assistant message', () => {
      const payload: MessageDispatch = {
        type: 'updateMessageTools',
        id: 'message1', // This is a user message, not an assistant message
        tool_call_id: 'tool1',
        value: { identifier: 'updatedCalculator' },
      };

      const newState = messagesReducer(initialState, payload);
      expect(newState).toBe(initialState);
    });

    it('should not modify state if tool is not found in the message', () => {
      const payload: MessageDispatch = {
        type: 'updateMessageTools',
        id: 'message2',
        tool_call_id: 'nonexistentTool',
        value: { identifier: 'updatedCalculator' },
      };

      const newState = messagesReducer(initialState, payload);
      expect(newState).toBe(initialState);
    });
  });

  describe('addMessageTool', () => {
    it('should add a tool to the specified assistant message if it does not have tools', () => {
      const stateWithAssistant: UIChatMessage[] = [
        ...initialState,
        {
          id: 'assistant1',
          role: 'assistant',
          content: '',
          createdAt: 1629264000000,
          updatedAt: 1629264000000,
        } as UIChatMessage,
      ];

      const toolPayload: ChatToolPayload = {
        id: 'tc_1',
        type: 'default',
        identifier: 'tool1',
        apiName: 'testFunction',
        arguments: '{"arg1": "value1"}',
      };

      const payload: MessageDispatch = {
        type: 'addMessageTool',
        id: 'assistant1',
        value: toolPayload,
      };

      const newState = messagesReducer(stateWithAssistant, payload);

      const assistant1 = newState.find((m) => m.id === 'assistant1');
      expect(assistant1?.tools).toHaveLength(1);
      expect(assistant1?.tools?.[0]).toEqual(toolPayload);
      expect(assistant1?.updatedAt).toBeGreaterThan(1629264000000);
    });

    it('should add a tool to the specified assistant message', () => {
      const toolPayload: ChatToolPayload = {
        id: 'tc_1',
        type: 'default',
        identifier: 'tool1',
        apiName: 'testFunction',
        arguments: '{"arg1": "value1"}',
      };

      const payload: MessageDispatch = {
        type: 'addMessageTool',
        id: 'message2',
        value: toolPayload,
      };

      const newState = messagesReducer(initialState, payload);

      expect(newState[1].tools).toHaveLength(2);
      expect(newState[1].tools?.[1]).toEqual(toolPayload);
    });

    it('should not modify the state if the message is not found', () => {
      const toolPayload: ChatToolPayload = {
        id: 'tc_1',
        type: 'default',
        identifier: 'tool1',
        apiName: 'testFunction',
        arguments: '{"arg1": "value1"}',
      };

      const payload: MessageDispatch = {
        type: 'addMessageTool',
        id: 'nonexistentMessage',
        value: toolPayload,
      };

      const newState = messagesReducer(initialState, payload);
      expect(newState).toBe(initialState);
    });

    it('should not add a tool if the message is not an assistant message', () => {
      const toolPayload: ChatToolPayload = {
        id: 'tc_1',
        type: 'default',
        identifier: 'tool1',
        apiName: 'testFunction',
        arguments: '{"arg1": "value1"}',
      };

      const payload: MessageDispatch = {
        type: 'addMessageTool',
        id: 'message1', // This is a user message
        value: toolPayload,
      };

      const newState = messagesReducer(initialState, payload);
      expect(newState).toBe(initialState);
    });

    it('should not add a tool if it already exists', () => {
      const toolPayload: ChatToolPayload = {
        id: 'abc', // Same id as existing tool
        type: 'default',
        identifier: 'tool1',
        apiName: 'testFunction',
        arguments: '{"arg1": "value1"}',
      };

      const payload: MessageDispatch = {
        type: 'addMessageTool',
        id: 'message2',
        value: toolPayload,
      };

      const newState = messagesReducer(initialState, payload);
      expect(newState).toBe(initialState);
    });
  });

  describe('deleteMessageTool', () => {
    it('should delete the specified tool from the message', () => {
      const payload: MessageDispatch = {
        type: 'deleteMessageTool',
        id: 'message2',
        tool_call_id: 'abc',
      };

      const newState = messagesReducer(initialState, payload);

      expect(newState[1].tools).toHaveLength(0);
      expect(newState[1].updatedAt).toBeGreaterThan(initialState[1].updatedAt);
    });

    it('should not modify the state if the message is not found', () => {
      const payload: MessageDispatch = {
        type: 'deleteMessageTool',
        id: 'nonexistentMessage',
        tool_call_id: 'tool1',
      };

      const newState = messagesReducer(initialState, payload);
      expect(newState).toBe(initialState);
    });

    it('should not modify the state if the message has no tools', () => {
      const payload: MessageDispatch = {
        type: 'deleteMessageTool',
        id: 'message1',
        tool_call_id: 'nonexistentTool',
      };

      const newState = messagesReducer(initialState, payload);
      expect(newState).toBe(initialState);
    });

    it('should not delete a tool if the message is not an assistant message', () => {
      const payload: MessageDispatch = {
        type: 'deleteMessageTool',
        id: 'message1', // This is a user message
        tool_call_id: 'tool1',
      };

      const newState = messagesReducer(initialState, payload);
      expect(newState).toBe(initialState);
    });
  });

  describe('createMessage', () => {
    it('should add a new message to the state', () => {
      const payload: MessageDispatch = {
        type: 'createMessage',
        id: 'newMessage',
        value: {
          content: 'New message content',
          role: 'user',
          sessionId: 'inbox',
        },
      };

      const newState = messagesReducer(initialState, payload);

      expect(newState.length).toBe(initialState.length + 1);
      const newMsg = newState.find((m) => m.id === 'newMessage');
      expect(newMsg).toBeDefined();
      expect(newMsg?.content).toBe('New message content');
      expect(newMsg?.role).toBe('user');
      expect(newMsg?.createdAt).toBeDefined();
      expect(newMsg?.updatedAt).toBeDefined();
    });
  });

  describe('deleteMessage', () => {
    it('should remove a message from the state', () => {
      const payload: MessageDispatch = {
        type: 'deleteMessage',
        id: 'message1',
      };

      const newState = messagesReducer(initialState, payload);

      expect(newState.length).toBe(initialState.length - 1);
      expect(newState.find((m) => m.id === 'message1')).toBeUndefined();
    });

    it('should not modify state if message to delete is not found', () => {
      const payload: MessageDispatch = {
        type: 'deleteMessage',
        id: 'nonexistentMessage',
      };

      const newState = messagesReducer(initialState, payload);
      expect(newState).toBe(initialState);
    });
  });

  describe('deleteMessages', () => {
    it('should remove multiple messages from the state', () => {
      const payload: MessageDispatch = {
        type: 'deleteMessages',
        ids: ['message1', 'message2'],
      };

      const newState = messagesReducer(initialState, payload);

      expect(newState.length).toBe(0);
      expect(newState.find((m) => m.id === 'message1')).toBeUndefined();
      expect(newState.find((m) => m.id === 'message2')).toBeUndefined();
    });

    it('should only delete existing messages', () => {
      const payload: MessageDispatch = {
        type: 'deleteMessages',
        ids: ['message1', 'nonexistent'],
      };

      const newState = messagesReducer(initialState, payload);

      expect(newState.length).toBe(1);
      expect(newState.find((m) => m.id === 'message1')).toBeUndefined();
      expect(newState.find((m) => m.id === 'message2')).toBeDefined();
    });

    it('should update child parentId when deleting parent chain', () => {
      // Create a tree: A -> B -> C -> D
      const treeState: UIChatMessage[] = [
        {
          id: 'A',
          content: 'A',
          role: 'user',
          createdAt: 1,
          updatedAt: 1,
          parentId: undefined,
        },
        {
          id: 'B',
          content: 'B',
          role: 'assistant',
          createdAt: 2,
          updatedAt: 2,
          parentId: 'A',
        },
        {
          id: 'C',
          content: 'C',
          role: 'tool',
          createdAt: 3,
          updatedAt: 3,
          parentId: 'B',
        },
        {
          id: 'D',
          content: 'D',
          role: 'user',
          createdAt: 4,
          updatedAt: 4,
          parentId: 'C',
        },
      ];

      // Delete B and C
      const payload: MessageDispatch = {
        type: 'deleteMessages',
        ids: ['B', 'C'],
      };

      const newState = messagesReducer(treeState, payload);

      // Should have A and D remaining
      expect(newState.length).toBe(2);
      expect(newState.find((m) => m.id === 'A')).toBeDefined();
      expect(newState.find((m) => m.id === 'D')).toBeDefined();

      // D's parentId should be updated to A (skipping deleted B and C)
      const messageD = newState.find((m) => m.id === 'D');
      expect(messageD?.parentId).toBe('A');
    });

    it('should set child parentId to undefined when deleting entire parent chain from root', () => {
      // Create a tree: A -> B -> C -> D
      const treeState: UIChatMessage[] = [
        {
          id: 'A',
          content: 'A',
          role: 'user',
          createdAt: 1,
          updatedAt: 1,
          parentId: undefined,
        },
        {
          id: 'B',
          content: 'B',
          role: 'assistant',
          createdAt: 2,
          updatedAt: 2,
          parentId: 'A',
        },
        {
          id: 'C',
          content: 'C',
          role: 'tool',
          createdAt: 3,
          updatedAt: 3,
          parentId: 'B',
        },
        {
          id: 'D',
          content: 'D',
          role: 'user',
          createdAt: 4,
          updatedAt: 4,
          parentId: 'C',
        },
      ];

      // Delete A, B, and C
      const payload: MessageDispatch = {
        type: 'deleteMessages',
        ids: ['A', 'B', 'C'],
      };

      const newState = messagesReducer(treeState, payload);

      // Should have only D remaining
      expect(newState.length).toBe(1);
      expect(newState[0].id).toBe('D');

      // D's parentId should be undefined (all ancestors deleted)
      expect(newState[0].parentId).toBeUndefined();
    });

    it('should handle multiple independent trees when batch deleting', () => {
      // Tree 1: A -> B -> C, Tree 2: X -> Y -> Z
      const treeState: UIChatMessage[] = [
        {
          id: 'A',
          content: 'A',
          role: 'user',
          createdAt: 1,
          updatedAt: 1,
          parentId: undefined,
        },
        {
          id: 'B',
          content: 'B',
          role: 'assistant',
          createdAt: 2,
          updatedAt: 2,
          parentId: 'A',
        },
        {
          id: 'C',
          content: 'C',
          role: 'user',
          createdAt: 3,
          updatedAt: 3,
          parentId: 'B',
        },
        {
          id: 'X',
          content: 'X',
          role: 'user',
          createdAt: 4,
          updatedAt: 4,
          parentId: undefined,
        },
        {
          id: 'Y',
          content: 'Y',
          role: 'assistant',
          createdAt: 5,
          updatedAt: 5,
          parentId: 'X',
        },
        {
          id: 'Z',
          content: 'Z',
          role: 'user',
          createdAt: 6,
          updatedAt: 6,
          parentId: 'Y',
        },
      ];

      // Delete B and Y
      const payload: MessageDispatch = {
        type: 'deleteMessages',
        ids: ['B', 'Y'],
      };

      const newState = messagesReducer(treeState, payload);

      // Should have A, C, X, Z remaining
      expect(newState.length).toBe(4);

      // C's parentId should be A
      const messageC = newState.find((m) => m.id === 'C');
      expect(messageC?.parentId).toBe('A');

      // Z's parentId should be X
      const messageZ = newState.find((m) => m.id === 'Z');
      expect(messageZ?.parentId).toBe('X');
    });
  });

  describe('updateMessages', () => {
    it('should replace entire state with new messages', () => {
      const newMessages: UIChatMessage[] = [
        {
          id: 'newMsg1',
          content: 'New content',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          role: 'user',
        },
      ];

      const payload: MessageDispatch = {
        type: 'updateMessages',
        value: newMessages,
      };

      const newState = messagesReducer(initialState, payload);

      expect(newState).toEqual(newMessages);
      expect(newState.find((m) => m.id === 'message1')).toBeUndefined();
      expect(newState.find((m) => m.id === 'message2')).toBeUndefined();
      expect(newState.find((m) => m.id === 'newMsg1')).toBeDefined();
    });
  });
});

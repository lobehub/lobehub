import {
  ChatMessageError,
  ChatPluginPayload,
  ChatTTS,
  ChatTranslate,
  UIChatMessage,
} from '@lobechat/types';
import dayjs from 'dayjs';
import { Mock, describe, expect, it, vi } from 'vitest';

import { CreateMessageParams, MessageModel } from '@/database/_deprecated/models/message';

import { ClientService } from './_deprecated';

const messageService = new ClientService();

// Mock the MessageModel
vi.mock('@/database/_deprecated/models/message', () => {
  return {
    MessageModel: {
      create: vi.fn(),
      batchCreate: vi.fn(),
      count: vi.fn(),
      query: vi.fn(),
      delete: vi.fn(),
      bulkDelete: vi.fn(),
      queryBySessionId: vi.fn(),
      update: vi.fn(),
      updatePlugin: vi.fn(),
      batchDelete: vi.fn(),
      clearTable: vi.fn(),
      batchUpdate: vi.fn(),
      queryAll: vi.fn(),
      updatePluginState: vi.fn(),
    },
  };
});

describe('MessageClientService', () => {
  // Mock data
  const mockMessageId = 'mock-message-id';
  const mockMessage = {
    id: mockMessageId,
    content: 'Mock message content',
    sessionId: 'mock-session-id',
    createdAt: 100,
    updatedAt: 100,
    role: 'user',
    // ... other properties
  } as UIChatMessage;
  const mockMessages = [mockMessage];

  beforeEach(() => {
    // Reset all mocks before running each test case
    vi.resetAllMocks();
  });

  describe('create', () => {
    it('should create a message and return its id', async () => {
      // Setup
      const createParams = {
        content: 'New message content',
        sessionId: '1',
        // ... other properties
      } as CreateMessageParams;
      (MessageModel.create as Mock).mockResolvedValue({ id: mockMessageId });

      // Execute
      const messageId = await messageService.createMessage(createParams);

      // Assert
      expect(MessageModel.create).toHaveBeenCalledWith(createParams);
      expect(messageId).toBe(mockMessageId);
    });
  });

  describe('batchCreate', () => {
    it('should batch create messages', async () => {
      // Setup
      (MessageModel.batchCreate as Mock).mockResolvedValue(mockMessages);

      // Execute
      const result = await messageService.batchCreateMessages(mockMessages);

      // Assert
      expect(MessageModel.batchCreate).toHaveBeenCalledWith(mockMessages);
      expect(result).toBe(mockMessages);
    });
  });

  describe('removeMessage', () => {
    it('should remove a message by id', async () => {
      // Setup
      (MessageModel.delete as Mock).mockResolvedValue(true);

      // Execute
      const result = await messageService.removeMessage(mockMessageId);

      // Assert
      expect(MessageModel.delete).toHaveBeenCalledWith(mockMessageId);
      expect(result).toBe(true);
    });
  });
  describe('removeMessages', () => {
    it('should remove a message by id', async () => {
      // Setup
      (MessageModel.bulkDelete as Mock).mockResolvedValue(true);

      // Execute
      const result = await messageService.removeMessages([mockMessageId]);

      // Assert
      expect(MessageModel.bulkDelete).toHaveBeenCalledWith([mockMessageId]);
      expect(result).toBe(true);
    });
  });

  describe('getMessages', () => {
    it('should retrieve messages by sessionId and topicId', async () => {
      // Setup
      const sessionId = 'session-id';
      const topicId = 'topic-id';
      (MessageModel.query as Mock).mockResolvedValue(mockMessages);

      // Execute
      const messages = await messageService.getMessages(sessionId, topicId);

      // Assert
      expect(MessageModel.query).toHaveBeenCalledWith({ sessionId, topicId });
      expect(messages).toEqual(mockMessages.map((i) => ({ ...i, imageList: [] })));
    });
  });

  describe('getAllMessagesInSession', () => {
    it('should retrieve all messages in a session', async () => {
      // Setup
      const sessionId = 'session-id';
      (MessageModel.queryBySessionId as Mock).mockResolvedValue(mockMessages);

      // Execute
      const messages = await messageService.getAllMessagesInSession(sessionId);

      // Assert
      expect(MessageModel.queryBySessionId).toHaveBeenCalledWith(sessionId);
      expect(messages).toBe(mockMessages);
    });
  });

  describe('removeMessagesByAssistant', () => {
    it('should batch remove messages by assistantId and topicId', async () => {
      // Setup
      const assistantId = 'assistant-id';
      const topicId = 'topic-id';
      (MessageModel.batchDelete as Mock).mockResolvedValue(true);

      // Execute
      const result = await messageService.removeMessagesByAssistant(assistantId, topicId);

      // Assert
      expect(MessageModel.batchDelete).toHaveBeenCalledWith(assistantId, topicId);
      expect(result).toBe(true);
    });
  });

  describe('clearAllMessage', () => {
    it('should clear all messages from the table', async () => {
      // Setup
      (MessageModel.clearTable as Mock).mockResolvedValue(true);

      // Execute
      const result = await messageService.removeAllMessages();

      // Assert
      expect(MessageModel.clearTable).toHaveBeenCalled();
      expect(result).toBe(true);
    });
  });

  describe('bindMessagesToTopic', () => {
    it('should batch update messages to bind them to a topic', async () => {
      // Setup
      const topicId = 'topic-id';
      const messageIds = [mockMessageId];
      (MessageModel.batchUpdate as Mock).mockResolvedValue(mockMessages);

      // Execute
      const result = await messageService.bindMessagesToTopic(topicId, messageIds);

      // Assert
      expect(MessageModel.batchUpdate).toHaveBeenCalledWith(messageIds, { topicId });
      expect(result).toBe(mockMessages);
    });
  });

  describe('getAllMessages', () => {
    it('should retrieve all messages', async () => {
      // Setup
      (MessageModel.queryAll as Mock).mockResolvedValue(mockMessages);

      // Execute
      const messages = await messageService.getAllMessages();

      // Assert
      expect(MessageModel.queryAll).toHaveBeenCalled();
      expect(messages).toBe(mockMessages);
    });
  });

  describe('updateMessageError', () => {
    it('should update the error field of a message', async () => {
      // Setup
      const newError = {
        type: 'InvalidProviderAPIKey',
        message: 'Error occurred',
      } as ChatMessageError;
      (MessageModel.update as Mock).mockResolvedValue({ ...mockMessage, error: newError });

      // Execute
      const result = await messageService.updateMessageError(mockMessageId, newError);

      // Assert
      expect(MessageModel.update).toHaveBeenCalledWith(mockMessageId, { error: newError });
      expect(result).toEqual({ ...mockMessage, error: newError });
    });
  });

  // describe('updateMessagePlugin', () => {
  // it('should update the plugin payload of a message', async () => {
  //   // Setup
  //   const newPlugin = {
  //     type: 'default',
  //     apiName: 'abc',
  //     arguments: '',
  //     identifier: 'plugin1',
  //   } as ChatPluginPayload;
  //
  //   (MessageModel.update as Mock).mockResolvedValue({ ...mockMessage, plugin: newPlugin });
  //
  //   // Execute
  //   const result = await messageService.updateMessagePlugin(mockMessageId, newPlugin);
  //
  //   // Assert
  //   expect(MessageModel.update).toHaveBeenCalledWith(mockMessageId, { plugin: newPlugin });
  //   expect(result).toEqual({ ...mockMessage, plugin: newPlugin });
  // });
  // });

  describe('updateMessagePluginState', () => {
    it('should update the plugin state of a message', async () => {
      // Setup
      const key = 'stateKey';
      const value = 'stateValue';
      const newPluginState = { [key]: value };
      (MessageModel.updatePluginState as Mock).mockResolvedValue({
        ...mockMessage,
        pluginState: newPluginState,
      });

      // Execute
      const result = await messageService.updateMessagePluginState(mockMessageId, { key: value });

      // Assert
      expect(MessageModel.updatePluginState).toHaveBeenCalledWith(mockMessageId, { key: value });
      expect(result).toEqual({ ...mockMessage, pluginState: newPluginState });
    });
  });

  describe('updateMessagePluginArguments', () => {
    it('should update the plugin arguments object of a message', async () => {
      // Setup
      const key = 'stateKey';
      const value = 'stateValue';
      (MessageModel.updatePlugin as Mock).mockResolvedValue({});

      // Execute
      await messageService.updateMessagePluginArguments(mockMessageId, { key: value });

      // Assert
      expect(MessageModel.updatePlugin).toHaveBeenCalledWith(mockMessageId, {
        arguments: '{"key":"stateValue"}',
      });
    });
    it('should update the plugin arguments string of a message', async () => {
      // Setup
      const key = 'stateKey';
      const value = 'stateValue';
      (MessageModel.updatePlugin as Mock).mockResolvedValue({});

      // Execute
      await messageService.updateMessagePluginArguments(
        mockMessageId,
        JSON.stringify({ key: value }),
      );

      // Assert
      expect(MessageModel.updatePlugin).toHaveBeenCalledWith(mockMessageId, {
        arguments: '{"key":"stateValue"}',
      });
    });
  });

  describe('countMessages', () => {
    it('should count the total number of messages', async () => {
      // Setup
      const mockCount = 10;
      (MessageModel.count as Mock).mockResolvedValue(mockCount);

      // Execute
      const count = await messageService.countMessages();

      // Assert
      expect(MessageModel.count).toHaveBeenCalled();
      expect(count).toBe(mockCount);
    });
  });

  describe('countTodayMessages', () => {
    it('should count the number of messages created today', async () => {
      // Setup
      const today = dayjs().format('YYYY-MM-DD');
      const mockMessages = [
        { ...mockMessage, createdAt: today },
        { ...mockMessage, createdAt: today },
        { ...mockMessage, createdAt: '2023-01-01' },
      ];
      (MessageModel.queryAll as Mock).mockResolvedValue(mockMessages);

      // Execute
      const count = await messageService.countTodayMessages();

      // Assert
      expect(MessageModel.queryAll).toHaveBeenCalled();
      expect(count).toBe(2);
    });
  });

  describe('updateMessageTTS', () => {
    it('should update the TTS field of a message', async () => {
      // Setup
      const newTTS: ChatTTS = {
        contentMd5: 'abc',
        file: 'file-abc',
      };

      (MessageModel.update as Mock).mockResolvedValue({ ...mockMessage, tts: newTTS });

      // Execute
      const result = await messageService.updateMessageTTS(mockMessageId, newTTS);

      // Assert
      expect(MessageModel.update).toHaveBeenCalledWith(mockMessageId, { tts: newTTS });
      expect(result).toEqual({ ...mockMessage, tts: newTTS });
    });
  });

  describe('updateMessageTranslate', () => {
    it('should update the translate field of a message', async () => {
      // Setup
      const newTranslate: ChatTranslate = {
        content: 'Translated text',
        to: 'es',
      };

      (MessageModel.update as Mock).mockResolvedValue({ ...mockMessage, translate: newTranslate });

      // Execute
      const result = await messageService.updateMessageTranslate(mockMessageId, newTranslate);

      // Assert
      expect(MessageModel.update).toHaveBeenCalledWith(mockMessageId, { translate: newTranslate });
      expect(result).toEqual({ ...mockMessage, translate: newTranslate });
    });
  });

  describe('hasMessages', () => {
    it('should return true if there are messages', async () => {
      // Setup
      (MessageModel.count as Mock).mockResolvedValue(1);

      // Execute
      const result = await messageService.hasMessages();

      // Assert
      expect(result).toBe(true);
    });

    it('should return false if there are no messages', async () => {
      // Setup
      (MessageModel.count as Mock).mockResolvedValue(0);

      // Execute
      const result = await messageService.hasMessages();

      // Assert
      expect(result).toBe(false);
    });
  });
});

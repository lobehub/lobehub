import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useChatStore } from '@/store/chat/store';

import { agentRunSelectors } from './selectors';

describe('agentRunSelectors', () => {
  beforeEach(() => {
    useChatStore.setState(useChatStore.getInitialState());
  });

  describe('isMessageInReasoning', () => {
    it('should return true when message has reasoning operation', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        useChatStore.setState({ activeAgentId: 'session1', activeTopicId: 'topic1' });
        result.current.startOperation({
          type: 'reasoning',
          context: { agentId: 'session1', topicId: 'topic1', messageId: 'msg1' },
        });
      });

      expect(agentRunSelectors.isMessageInReasoning('msg1')(result.current)).toBe(true);
    });

    it('should return false when message has no reasoning operation', () => {
      const { result } = renderHook(() => useChatStore());

      expect(agentRunSelectors.isMessageInReasoning('msg1')(result.current)).toBe(false);
    });
  });

  describe('isMessageInSearchWorkflow', () => {
    it('should return true when message is in search workflow', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        useChatStore.setState({ searchWorkflowLoadingIds: ['msg1', 'msg2'] });
      });

      expect(agentRunSelectors.isMessageInSearchWorkflow('msg1')(result.current)).toBe(true);
      expect(agentRunSelectors.isMessageInSearchWorkflow('msg2')(result.current)).toBe(true);
    });

    it('should return false when message is not in search workflow', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        useChatStore.setState({ searchWorkflowLoadingIds: ['msg1'] });
      });

      expect(agentRunSelectors.isMessageInSearchWorkflow('msg2')(result.current)).toBe(false);
    });
  });

  describe('isIntentUnderstanding', () => {
    it('should return true when message is in search workflow', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        useChatStore.setState({ searchWorkflowLoadingIds: ['msg1'] });
      });

      expect(agentRunSelectors.isIntentUnderstanding('msg1')(result.current)).toBe(true);
    });

    it('should return false when message is not in search workflow', () => {
      const { result } = renderHook(() => useChatStore());

      expect(agentRunSelectors.isIntentUnderstanding('msg1')(result.current)).toBe(false);
    });
  });

  describe('isCurrentSendMessageLoading', () => {
    it('should return true when there is a running sendMessage operation in current context', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        useChatStore.setState({ activeAgentId: 'session1', activeTopicId: 'topic1' });
        result.current.startOperation({
          type: 'sendMessage',
          context: { agentId: 'session1', topicId: 'topic1' },
        });
      });

      expect(agentRunSelectors.isCurrentSendMessageLoading(result.current)).toBe(true);
    });

    it('should return false when there is no sendMessage operation', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        useChatStore.setState({ activeAgentId: 'session1', activeTopicId: 'topic1' });
      });

      expect(agentRunSelectors.isCurrentSendMessageLoading(result.current)).toBe(false);
    });

    it('should return false when sendMessage operation is completed', () => {
      const { result } = renderHook(() => useChatStore());

      let opId: string;

      act(() => {
        useChatStore.setState({ activeAgentId: 'session1', activeTopicId: 'topic1' });
        opId = result.current.startOperation({
          type: 'sendMessage',
          context: { agentId: 'session1', topicId: 'topic1' },
        }).operationId;
      });

      act(() => {
        result.current.completeOperation(opId);
      });

      expect(agentRunSelectors.isCurrentSendMessageLoading(result.current)).toBe(false);
    });

    it('should return false for different context', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        useChatStore.setState({ activeAgentId: 'session1', activeTopicId: 'topic1' });
        result.current.startOperation({
          type: 'sendMessage',
          context: { agentId: 'session2', topicId: 'topic2' },
        });
      });

      expect(agentRunSelectors.isCurrentSendMessageLoading(result.current)).toBe(false);
    });
  });

  describe('isCurrentSendMessageError', () => {
    it('should return error message when latest sendMessage operation has error', () => {
      const { result } = renderHook(() => useChatStore());

      let opId: string;

      act(() => {
        useChatStore.setState({ activeAgentId: 'session1', activeTopicId: 'topic1' });
        opId = result.current.startOperation({
          type: 'sendMessage',
          context: { agentId: 'session1', topicId: 'topic1' },
        }).operationId;
      });

      act(() => {
        result.current.updateOperationMetadata(opId, {
          inputSendErrorMsg: 'Network error',
        });
      });

      expect(agentRunSelectors.isCurrentSendMessageError(result.current)).toBe('Network error');
    });

    it('should return undefined when there is no error', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        useChatStore.setState({ activeAgentId: 'session1', activeTopicId: 'topic1' });
        result.current.startOperation({
          type: 'sendMessage',
          context: { agentId: 'session1', topicId: 'topic1' },
        });
      });

      expect(agentRunSelectors.isCurrentSendMessageError(result.current)).toBeUndefined();
    });

    it('should return undefined when there are no operations', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        useChatStore.setState({ activeAgentId: 'session1', activeTopicId: 'topic1' });
      });

      expect(agentRunSelectors.isCurrentSendMessageError(result.current)).toBeUndefined();
    });

    it('should return the latest error when multiple operations exist', () => {
      const { result } = renderHook(() => useChatStore());

      let op1Id: string;
      let op2Id: string;

      act(() => {
        useChatStore.setState({ activeAgentId: 'session1', activeTopicId: 'topic1' });

        op1Id = result.current.startOperation({
          type: 'sendMessage',
          context: { agentId: 'session1', topicId: 'topic1' },
        }).operationId;

        op2Id = result.current.startOperation({
          type: 'sendMessage',
          context: { agentId: 'session1', topicId: 'topic1' },
        }).operationId;
      });

      act(() => {
        result.current.updateOperationMetadata(op1Id, {
          inputSendErrorMsg: 'First error',
        });
        result.current.updateOperationMetadata(op2Id, {
          inputSendErrorMsg: 'Second error',
        });
      });

      // Should return the latest (second) error
      expect(agentRunSelectors.isCurrentSendMessageError(result.current)).toBe('Second error');
    });
  });

  describe('isSendMessageLoadingForTopic', () => {
    it('should return true when sendMessage operation is running for the topic', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        result.current.startOperation({
          type: 'sendMessage',
          context: { agentId: 'session1', topicId: 'topic1' },
        });
      });

      expect(
        agentRunSelectors.isSendMessageLoadingForTopic('main_session1_topic1')(result.current),
      ).toBe(true);
    });

    it('should return false when no sendMessage operation exists', () => {
      const { result } = renderHook(() => useChatStore());

      expect(
        agentRunSelectors.isSendMessageLoadingForTopic('main_session1_topic1')(result.current),
      ).toBe(false);
    });

    it('should return false when sendMessage operation is completed', () => {
      const { result } = renderHook(() => useChatStore());

      let opId: string;

      act(() => {
        opId = result.current.startOperation({
          type: 'sendMessage',
          context: { agentId: 'session1', topicId: 'topic1' },
        }).operationId;
      });

      act(() => {
        result.current.completeOperation(opId);
      });

      expect(
        agentRunSelectors.isSendMessageLoadingForTopic('main_session1_topic1')(result.current),
      ).toBe(false);
    });

    it('should distinguish between different topics', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        result.current.startOperation({
          type: 'sendMessage',
          context: { agentId: 'session1', topicId: 'topic1' },
        });
      });

      expect(
        agentRunSelectors.isSendMessageLoadingForTopic('main_session1_topic1')(result.current),
      ).toBe(true);
      expect(
        agentRunSelectors.isSendMessageLoadingForTopic('main_session1_topic2')(result.current),
      ).toBe(false);
    });
  });
});

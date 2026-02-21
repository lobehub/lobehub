import { expect } from 'vitest';

import { type OperationType } from '@/store/chat/slices/operation/types';
import { type ChatStore } from '@/store/chat/store';

/**
 * Assert that an operation was created with specific type
 */
export const expectOperationCreated = (mockStore: ChatStore, type: OperationType) => {
  expect(mockStore.startOperation).toHaveBeenCalledWith(
    expect.objectContaining({
      type,
    }),
  );
};

/**
 * Assert that a message was created with specific role
 */
export const expectMessageCreated = (mockStore: ChatStore, role: 'assistant' | 'tool' | 'user') => {
  expect(mockStore.optimisticCreateMessage).toHaveBeenCalledWith(
    expect.objectContaining({
      role,
    }),
    expect.objectContaining({
      operationId: expect.any(String),
    }),
  );
};

/**
 * Assert that a cancel handler was registered
 */
export const expectCancelHandlerRegistered = (mockStore: ChatStore, operationId?: string) => {
  if (operationId) {
    expect(mockStore.onOperationCancel).toHaveBeenCalledWith(operationId, expect.any(Function));
  } else {
    expect(mockStore.onOperationCancel).toHaveBeenCalled();
  }
};

/**
 * Assert that an operation was completed
 */
export const expectOperationCompleted = (mockStore: ChatStore, operationId: string) => {
  expect(mockStore.completeOperation).toHaveBeenCalledWith(operationId);
};

/**
 * Assert that an operation was failed
 */
export const expectOperationFailed = (
  mockStore: ChatStore,
  operationId: string,
  errorType?: string,
) => {
  if (errorType) {
    expect(mockStore.failOperation).toHaveBeenCalledWith(
      operationId,
      expect.objectContaining({
        type: errorType,
      }),
    );
  } else {
    expect(mockStore.failOperation).toHaveBeenCalledWith(operationId, expect.any(Object));
  }
};

/**
 * Assert that message content was updated
 */
export const expectMessageContentUpdated = (
  mockStore: ChatStore,
  messageId: string,
  content?: string,
) => {
  if (content) {
    expect(mockStore.optimisticUpdateMessageContent).toHaveBeenCalledWith(
      messageId,
      content,
      expect.anything(),
      expect.anything(),
    );
  } else {
    expect(mockStore.optimisticUpdateMessageContent).toHaveBeenCalledWith(
      messageId,
      expect.any(String),
      expect.anything(),
      expect.anything(),
    );
  }
};

/**
 * Assert that message plugin was updated
 */
export const expectMessagePluginUpdated = (
  mockStore: ChatStore,
  messageId: string,
  interventionStatus?: string,
) => {
  if (interventionStatus) {
    expect(mockStore.optimisticUpdateMessagePlugin).toHaveBeenCalledWith(
      messageId,
      expect.objectContaining({
        intervention: expect.objectContaining({
          status: interventionStatus,
        }),
      }),
      expect.anything(),
    );
  } else {
    expect(mockStore.optimisticUpdateMessagePlugin).toHaveBeenCalled();
  }
};

/**
 * Assert that internal_fetchAIChatMessage was called with correct params
 */
export const expectFetchAIChatMessageCalled = (mockStore: ChatStore, messageId?: string) => {
  if (messageId) {
    expect(mockStore.internal_fetchAIChatMessage).toHaveBeenCalledWith(
      messageId,
      expect.anything(),
    );
  } else {
    expect(mockStore.internal_fetchAIChatMessage).toHaveBeenCalled();
  }
};

/**
 * Assert that internal_invokeDifferentTypePlugin was called
 */
export const expectInvokePluginCalled = (mockStore: ChatStore, messageId?: string) => {
  if (messageId) {
    expect(mockStore.internal_invokeDifferentTypePlugin).toHaveBeenCalledWith(
      messageId,
      expect.anything(),
    );
  } else {
    expect(mockStore.internal_invokeDifferentTypePlugin).toHaveBeenCalled();
  }
};

/**
 * Assert that operation metadata was updated
 */
export const expectOperationMetadataUpdated = (
  mockStore: ChatStore,
  operationId: string,
  metadata?: Record<string, any>,
) => {
  if (metadata) {
    expect(mockStore.updateOperationMetadata).toHaveBeenCalledWith(
      operationId,
      expect.objectContaining(metadata),
    );
  } else {
    expect(mockStore.updateOperationMetadata).toHaveBeenCalledWith(operationId, expect.any(Object));
  }
};

/**
 * Assert executor result structure
 */
export const expectValidExecutorResult = (result: any) => {
  expect(result).toHaveProperty('events');
  expect(result).toHaveProperty('newState');
  expect(Array.isArray(result.events)).toBe(true);
  expect(result.newState).toBeDefined();
};

/**
 * Assert executor returned specific event type
 */
export const expectEventType = (result: any, eventType: string) => {
  expect(result.events.some((e: any) => e.type === eventType)).toBe(true);
};

/**
 * Assert executor returned next context
 */
export const expectNextContext = (result: any, phase?: string) => {
  expect(result.nextContext).toBeDefined();
  if (phase) {
    expect(result.nextContext.phase).toBe(phase);
  }
};

import { nanoid } from '@lobechat/utils';

import { type Operation, type OperationType } from '@/store/chat/slices/operation/types';

/**
 * Create a mock Operation object for testing
 */
export const createMockOperation = (
  type: OperationType,
  context: Record<string, any> = {},
  overrides: Partial<Operation> = {},
): Operation => {
  return {
    abortController: new AbortController(),
    childOperationIds: [],
    context,
    id: `op_${nanoid()}`,
    metadata: {
      startTime: Date.now(),
    },
    status: 'running',
    type,
    ...overrides,
  };
};

/**
 * Create a cancelled operation
 */
export const createCancelledOperation = (
  type: OperationType,
  context: Record<string, any> = {},
): Operation => {
  const operation = createMockOperation(type, context, { status: 'cancelled' });
  operation.abortController.abort();
  operation.metadata.cancelReason = 'Test cancellation';
  return operation;
};

/**
 * Create a completed operation
 */
export const createCompletedOperation = (
  type: OperationType,
  context: Record<string, any> = {},
): Operation => {
  return createMockOperation(type, context, {
    metadata: {
      duration: 1000,
      endTime: Date.now(),
      startTime: Date.now() - 1000,
    },
    status: 'completed',
  });
};

/**
 * Create a failed operation
 */
export const createFailedOperation = (
  type: OperationType,
  context: Record<string, any> = {},

  error: { message: string; type: string } = { message: 'Test error', type: 'TestError' },
): Operation => {
  return createMockOperation(type, context, {
    metadata: {
      duration: 1000,
      endTime: Date.now(),
      error,
      startTime: Date.now() - 1000,
    },
    status: 'failed',
  });
};

/**
 * Create an operation tree (parent with children)
 */
export const createOperationTree = (
  parentType: OperationType,
  childTypes: OperationType[],
  context: Record<string, any> = {},
) => {
  const parent = createMockOperation(parentType, context);

  const children = childTypes.map((childType) =>
    createMockOperation(childType, context, {
      parentOperationId: parent.id,
    }),
  );

  parent.childOperationIds = children.map((c) => c.id);

  return { children, parent };
};

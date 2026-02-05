import type {ChatStoreState} from '@/store/chat';

const isInterpreterExecuting = (id: string) => (s: ChatStoreState) => {
  // Check if there's a running builtinToolInterpreter operation for this message
  const operationId = s.messageOperationMap[id];
  if (!operationId) return false;

  const operation = s.operations[operationId];
  return operation?.type === 'builtinToolInterpreter' && operation?.status === 'running';
};

const isSearXNGSearching = (id: string) => (s: ChatStoreState) => {
  // Check if there's a running builtinToolSearch operation for this message
  const operationId = s.messageOperationMap[id];
  if (!operationId) return false;

  const operation = s.operations[operationId];
  return operation?.type === 'builtinToolSearch' && operation?.status === 'running';
};

const isSearchingLocalFiles = (id: string) => (s: ChatStoreState) => {
  // Check if there's a running builtinToolLocalSystem operation for this message
  const operationId = s.messageOperationMap[id];
  if (!operationId) return false;

  const operation = s.operations[operationId];
  return operation?.type === 'builtinToolLocalSystem' && operation?.status === 'running';
};

export const chatToolSelectors = {
  isInterpreterExecuting,
  isSearXNGSearching,
  isSearchingLocalFiles,
};

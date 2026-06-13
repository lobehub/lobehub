import type { OperationType } from '@/store/chat/slices/operation/types';

export type OperationActivityKey =
  | 'compressing'
  | 'generating'
  | 'reasoning'
  | 'searching'
  | 'toolCalling';

const DIRECT_OPERATION_LABEL_KEYS: Partial<Record<OperationType, string>> = {
  contextCompression: 'operation.contextCompression',
  execAgentRuntime: 'operation.execAgentRuntime',
  execClientSubAgent: 'operation.execClientSubAgent',
  execServerAgentRuntime: 'operation.execServerAgentRuntime',
  sendMessage: 'operation.sendMessage',
  toolCalling: 'operation.toolCalling',
};

const ACTIVITY_LABEL_KEYS: Record<OperationActivityKey, string> = {
  compressing: 'opStatusTray.status.compressing',
  generating: 'opStatusTray.status.generating',
  reasoning: 'opStatusTray.status.reasoning',
  searching: 'opStatusTray.status.searching',
  toolCalling: 'opStatusTray.status.toolCalling',
};

/**
 * Map internal operation types to user-facing running phases.
 * Container ops and bookkeeping ops return undefined.
 */
export const resolveOperationActivity = (type: OperationType): OperationActivityKey | undefined => {
  if (type === 'reasoning') return 'reasoning';
  if (
    type === 'toolCalling' ||
    type === 'executeToolCall' ||
    type === 'createToolMessage' ||
    type === 'pluginApi' ||
    type.startsWith('builtinTool')
  )
    return 'toolCalling';
  if (type === 'rag' || type === 'searchWorkflow') return 'searching';
  if (type === 'contextCompression' || type === 'generateSummary') return 'compressing';
  if (
    type === 'callLLM' ||
    type === 'groupAgentStream' ||
    type === 'createAssistantMessage' ||
    type === 'supervisorDecision'
  )
    return 'generating';
  return undefined;
};

export const resolveOperationLoadingLabelKey = (type: OperationType): string | undefined => {
  const directKey = DIRECT_OPERATION_LABEL_KEYS[type];
  if (directKey) return directKey;

  const activity = resolveOperationActivity(type);
  return activity ? ACTIVITY_LABEL_KEYS[activity] : undefined;
};

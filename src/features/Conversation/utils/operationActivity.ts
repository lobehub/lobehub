import { type OperationType } from '@/store/chat/slices/operation/types';

/**
 * User-facing streaming phase. Each key has a matching `opStatusTray.status.*`
 * locale entry, so a phase can always be rendered without leaking a raw key.
 */
export type ActivityKey = 'compressing' | 'generating' | 'reasoning' | 'searching' | 'toolCalling';

/**
 * Map a running (sub-)operation type to the user-facing streaming phase.
 *
 * Many `OperationType`s are internal/bookkeeping ops (`createToolMessage`,
 * `executeToolCall`, `pluginApi`, `builtinTool*`, `callLLM`, ...) that have no
 * dedicated user copy. Both `OpStatusTray` and `ContentLoading` route them
 * through this helper so they reuse the localized phase labels instead of
 * exposing the raw `operation.*` i18n key.
 *
 * Container ops (AI_RUNTIME) and other bookkeeping ops return undefined.
 */
export const resolveOperationActivity = (type: OperationType): ActivityKey | undefined => {
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

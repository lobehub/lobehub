// Main parse function
export { parse } from './parse';

// Assistant group authored-content semantics
export type {
  AssistantGroupAnswerSegment,
  AssistantGroupBlockProjection,
  AssistantGroupSegment,
  AssistantGroupSemanticBlock,
  AssistantGroupWorkflowSegment,
  PartitionAssistantGroupOptions,
  PartitionedAssistantGroup,
  SplitAssistantGroupSegments,
} from './assistantGroupContent';
export {
  isAssistantGroupStatusText,
  partitionAssistantGroupBlocks,
  resolveAssistantGroupFinalContent,
  splitAssistantGroupFinalAnswer,
} from './assistantGroupContent';

// Topic Doctor - detect and repair message trees the reader cannot fully render
export type { RepairOp, TopicDiagnosis, TopicIssue, TopicIssueKind } from './doctor';
export { diagnoseTopic } from './doctor';

// Context Tree Types - for navigation and context understanding
export type {
  AssistantGroupNode,
  BranchNode,
  CompareNode,
  ContextNode,
  MessageNode,
  SignalCallbacksNode,
} from './types';

// Flat Message List Types - for virtual list rendering
export type { FlatMessage, FlatMessageExtra, FlatMessageRole } from './types';

// Shared Types
export type { HelperMaps, IdNode, Message, MessageGroupMetadata, ParseResult } from './types';

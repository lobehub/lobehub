import {
  type ChatImageItem,
  type ChatToolPayload,
  type GroundingSearch,
  type MessageToolCall,
  type ModelPerformance,
  type ModelReasoning,
  type ModelUsage,
} from '@lobechat/types';

/**
 * Streaming context - immutable configuration
 */
export interface StreamingContext {
  agentId: string;
  groupId?: string;
  messageId: string;
  operationId?: string;
  topicId?: string | null;
}

/**
 * Reasoning state — same shape as the persisted message reasoning metadata
 */
export type ReasoningState = ModelReasoning;

/**
 * Grounding/search data - extends GroundingSearch for compatibility
 */
export type GroundingData = GroundingSearch;

/**
 * Streaming callbacks - for notifying external state changes
 */
export interface StreamingCallbacks {
  /** Content update */
  onContentUpdate: (
    content: string,
    reasoning?: ReasoningState,
    contentMetadata?: { isMultimodal: boolean; tempDisplayContent: string },
  ) => void;
  /** Search grounding update */
  onGroundingUpdate: (grounding: GroundingData) => void;
  /** Image list update */
  onImagesUpdate: (images: ChatImageItem[]) => void;
  /** Complete reasoning operation */
  onReasoningComplete: (operationId: string) => void;
  /** Start reasoning operation */
  onReasoningStart: () => string | undefined;
  /** Reasoning state update */
  onReasoningUpdate: (reasoning: ReasoningState) => void;
  /** Tool calls update */
  onToolCallsUpdate: (tools: ChatToolPayload[]) => void;
  /** Toggle tool calling streaming animation */
  toggleToolCallingStreaming: (messageId: string, isAnimationActives?: boolean[]) => void;
  /** Transform tool calls */
  transformToolCalls: (toolCalls: MessageToolCall[]) => ChatToolPayload[];
  /** Upload base64 image */
  uploadBase64Image: (base64Data: string) => Promise<{ id?: string; url?: string }>;
}

/**
 * Finish callback data
 */
export interface FinishData {
  grounding?: GroundingData;
  observationId?: string | null;
  reasoning?: ModelReasoning;
  speed?: ModelPerformance;
  toolCalls?: MessageToolCall[];
  traceId?: string | null;
  type?: string;
  usage?: ModelUsage;
}

/**
 * Final streaming result
 */
export interface StreamingResult {
  content: string;
  finishType?: string;
  isFunctionCall: boolean;
  metadata: {
    finishType?: string;
    imageList?: ChatImageItem[];
    isMultimodal?: boolean;
    performance?: ModelPerformance;
    reasoning?: ReasoningState;
    search?: GroundingData;
    usage?: ModelUsage;
  };
  toolCalls?: MessageToolCall[];
  tools?: ChatToolPayload[];
  traceId?: string;
  usage?: ModelUsage;
}

/**
 * Stream chunk types
 */
export type StreamChunk =
  | { text: string; type: 'text' }
  | { text: string; type: 'reasoning' }
  | { content: string; mimeType?: string; partType: 'text' | 'image'; type: 'reasoning_part' }
  | { content: string; mimeType?: string; partType: 'text' | 'image'; type: 'content_part' }
  | {
      isAnimationActives?: boolean[];
      tool_calls: MessageToolCall[];
      type: 'tool_calls';
    }
  | { grounding?: GroundingData; type: 'grounding' }
  | {
      image: { data: string; id: string };
      images: { data: string; id: string }[];
      type: 'base64_image';
    }
  | { type: 'stop' };

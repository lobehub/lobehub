import { ModelPerformance, ModelTokensUsage, ModelUsage } from '@lobechat/types';

import { MessageToolCall, MessageToolCallChunk } from './toolsCalling';

export type LLMRoleType = 'user' | 'system' | 'assistant' | 'function' | 'tool';

export type ChatResponseFormat =
  | { type: 'json_object' }
  | {
      json_schema: {
        name: string;
        schema: Record<string, any>;
        strict?: boolean;
      };
      type: 'json_schema';
    };

interface UserMessageContentPartThinking {
  signature: string;
  thinking: string;
  type: 'thinking';
}
interface UserMessageContentPartText {
  text: string;
  type: 'text';
}

interface UserMessageContentPartImage {
  image_url: {
    detail?: 'auto' | 'low' | 'high';
    url: string;
  };
  type: 'image_url';
}

interface UserMessageContentPartVideo {
  type: 'video_url';
  video_url: { url: string };
}

export type UserMessageContentPart =
  | UserMessageContentPartText
  | UserMessageContentPartImage
  | UserMessageContentPartVideo
  | UserMessageContentPartThinking;

export interface OpenAIChatMessage {
  content: string | UserMessageContentPart[];
  name?: string;
  reasoning?: {
    content?: string;
    duration?: number;
  };
  role: LLMRoleType;
  tool_call_id?: string;
  tool_calls?: MessageToolCall[];
}

/**
 * @title Chat Stream Payload
 */
export interface ChatStreamPayload {
  apiMode?: 'chatCompletion' | 'responses';
  /**
   * 开启上下文缓存
   */
  enabledContextCaching?: boolean;
  /**
   * 是否开启搜索
   */
  enabledSearch?: boolean;
  /**
   * @title 控制生成文本中的惩罚系数，用于减少重复性
   * @default 0
   */
  frequency_penalty?: number;
  /**
   * @title Image aspect ratio for image generation
   */
  imageAspectRatio?: string;
  /**
   * @title Image resolution for image generation (e.g., '1K', '2K', '4K')
   */
  imageResolution?: '1K' | '2K' | '4K';
  /**
   * @title 生成文本的最大长度
   */
  max_tokens?: number;
  /**
   * @title 聊天信息列表
   */
  messages: OpenAIChatMessage[];
  /**
   * @title 模型名称
   */
  model: string;
  /**
   * @title 返回的文本数量
   */
  n?: number;
  /**
   * @title 控制生成文本中的惩罚系数，用于减少主题的变化
   * @default 0
   */
  presence_penalty?: number;
  provider?: string;
  reasoning?: {
    effort?: string;
    summary?: string;
  };
  reasoning_effort?: 'minimal' | 'low' | 'medium' | 'high';
  responseMode?: 'stream' | 'json';
  response_format?: ChatResponseFormat;
  /**
   * @title 是否开启流式请求
   * @default true
   */
  stream?: boolean;
  /**
   * @title 生成文本的随机度量，用于控制文本的创造性和多样性
   * @default 1
   */
  temperature?: number;
  text?: {
    verbosity?: 'low' | 'medium' | 'high';
  };
  /**
   * use for Claude and Gemini
   */
  thinking?: {
    budget_tokens: number;
    type: 'enabled' | 'disabled';
  };
  thinkingBudget?: number;
  /**
   * Thinking level for Gemini models (e.g., gemini-3.0-pro)
   */
  thinkingLevel?: 'low' | 'high';
  tool_choice?: string;
  tools?: ChatCompletionTool[];
  /**
   * @title 控制生成文本中最高概率的单个令牌
   * @default 1
   */
  top_p?: number;
  truncation?: 'auto' | 'disabled';
  /**
   * @title Gemini URL 上下文获取工具开关
   */
  urlContext?: boolean;
  verbosity?: 'low' | 'medium' | 'high';
}

export interface ChatMethodOptions {
  callback?: ChatStreamCallbacks;
  /**
   * response headers
   */
  headers?: Record<string, any>;
  /**
   * send the request to the ai api endpoint
   */
  requestHeaders?: Record<string, any>;
  signal?: AbortSignal;
  /**
   * userId for the chat completion
   */
  user?: string;
}

export interface ChatCompletionFunctions {
  /**
   * The description of what the function does.
   * @type {string}
   * @memberof ChatCompletionFunctions
   */
  description?: string;
  /**
   * The name of the function to be called. Must be a-z, A-Z, 0-9, or contain underscores and dashes, with a maximum length of 64.
   * @type {string}
   * @memberof ChatCompletionFunctions
   */
  name: string;
  /**
   * The parameters the functions accepts, described as a JSON Schema object. See the [guide](/docs/guides/gpt/function-calling) for examples, and the [JSON Schema reference](https://json-schema.org/understanding-json-schema/) for documentation about the format.
   * @type {{ [key: string]: any }}
   * @memberof ChatCompletionFunctions
   */
  parameters?: {
    [key: string]: any;
  };
}

export interface ChatCompletionTool {
  function: ChatCompletionFunctions;

  /**
   * The type of the tool. Currently, only `function` is supported.
   */
  type: 'function';
}

export interface OnFinishData {
  grounding?: any;
  speed?: ModelPerformance;
  text: string;
  thinking?: string;
  toolsCalling?: MessageToolCall[];
  usage?: ModelUsage;
}

/**
 * Base64 image data from model output
 */
export interface Base64ImageData {
  /** Base64 encoded image data (with or without data URI prefix) */
  data: string;
  /** Unique identifier for the image */
  id: string;
}

/**
 * Content part data for multimodal output
 */
export interface ContentPartData {
  /** Text content or base64 image data */
  content: string;
  /** Image MIME type (for image parts) */
  mimeType?: string;
  /** Part type: text or image */
  partType: 'text' | 'image';
  /** Optional signature for reasoning verification (Google Gemini feature) */
  thoughtSignature?: string;
}

export interface ChatStreamCallbacks {
  /**
   * `onBase64Image`: Called when a base64 image is received from the model.
   * Used for models that generate images (e.g., GPT-4 with DALL-E, Gemini with image output)
   */
  onBase64Image?: (data: {
    /** The newly received image */
    image: Base64ImageData;
    /** All images received so far */
    images: Base64ImageData[];
  }) => Promise<void> | void;
  onCompletion?: (data: OnFinishData) => Promise<void> | void;
  /**
   * `onContentPart`: Called for each content part in multimodal output.
   * Used for models that return structured content with mixed text and images.
   */
  onContentPart?: (data: ContentPartData) => Promise<void> | void;
  /**
   * `onFinal`: Called once when the stream is closed with the final completion message.
   **/
  onFinal?: (data: OnFinishData) => Promise<void> | void;
  onGrounding?: (grounding: any) => Promise<void> | void;
  /**
   * `onReasoningPart`: Called for each reasoning/thinking part in multimodal output.
   * Used for models that return structured reasoning with mixed text and images.
   */
  onReasoningPart?: (data: ContentPartData) => Promise<void> | void;
  /** `onStart`: Called once when the stream is initialized. */
  onStart?: () => Promise<void> | void;
  /** `onText`: Called for each text chunk. */
  onText?: (content: string) => Promise<void> | void;
  onThinking?: (content: string) => Promise<void> | void;
  onToolsCalling?: (data: {
    chunk: MessageToolCallChunk[];
    /**
     * full tools calling array
     */
    toolsCalling: MessageToolCall[];
  }) => Promise<void> | void;
  onUsage?: (usage: ModelTokensUsage) => Promise<void> | void;
}

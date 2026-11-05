import type { AssistantGroupSemanticBlock } from '@lobechat/conversation-flow';

export interface RenderableAssistantContentBlock extends AssistantGroupSemanticBlock {
  contentOverride?: string;
  disableMarkdownStreaming?: boolean;
  domId?: string;
  hasToolsOverride?: boolean;
  renderKey?: string;
  /** Set on the first rendered projection of a wake-up step, so its notice shows once. */
  showTaskCompletionNotice?: boolean;
}

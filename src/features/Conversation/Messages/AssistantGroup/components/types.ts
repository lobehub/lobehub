import type { AssistantContentBlock } from '@/types/index';

export interface RenderableAssistantContentBlock extends AssistantContentBlock {
  contentOverride?: string;
  disableMarkdownStreaming?: boolean;
  domId?: string;
  hasToolsOverride?: boolean;
  renderKey?: string;
}

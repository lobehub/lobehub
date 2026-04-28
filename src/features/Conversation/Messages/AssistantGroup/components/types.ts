import type { AssistantContentBlock } from '@/types/index';

export interface RenderableAssistantContentBlock extends AssistantContentBlock {
  disableMarkdownStreaming?: boolean;
  domId?: string;
  renderKey?: string;
}

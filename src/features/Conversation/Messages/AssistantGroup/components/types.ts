import type { AssistantContentBlock } from '@/types/index';

export interface RenderableAssistantContentBlock extends AssistantContentBlock {
  domId?: string;
  renderKey?: string;
}

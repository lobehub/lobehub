import type { AssistantGroupSemanticBlock } from '@lobechat/conversation-flow';

export interface RenderableAssistantContentBlock extends AssistantGroupSemanticBlock {
  contentOverride?: string;
  disableMarkdownStreaming?: boolean;
  domId?: string;
  hasToolsOverride?: boolean;
  /**
   * Hide the "…is running" placeholder of a step that has nothing to show yet.
   * Set on every block except the turn's first, and only when the composer
   * mounts an OpStatusTray: that tray already reports the run is working, so a
   * second running line under earlier output (a tool card, text) is redundant.
   */
  hideStepLoading?: boolean;
  renderKey?: string;
  /** Set on the first rendered projection of a wake-up step, so its notice shows once. */
  showTaskCompletionNotice?: boolean;
}

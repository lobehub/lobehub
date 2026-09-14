export interface PageRewriteDraftTopicSwitcher {
  (topicId: null, options: { scope: 'page'; skipRefreshMessage: true }): Promise<void> | void;
}

/**
 * Move the page copilot to its unsaved draft topic for a fresh rewrite.
 *
 * Topic history and an in-flight generation remain persisted; only the
 * visible topic pointer and page-scoped draft cache are reset.
 */
export const switchToPageRewriteDraft = (switchTopic: PageRewriteDraftTopicSwitcher): void => {
  void switchTopic(null, { scope: 'page', skipRefreshMessage: true });
};

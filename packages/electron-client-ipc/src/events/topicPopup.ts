import type { TopicPopupInfo } from '../types/topicPopup';

export interface TopicPopupBroadcastEvents {
  /**
   * Emitted whenever the set of open topic popup windows changes
   * (a popup opens, closes, or is reassigned). The payload is the full
   * current list — renderers should replace their local registry with it
   * rather than applying a diff.
   */
  topicPopupsChanged: (data: { popups: TopicPopupInfo[] }) => void;
}

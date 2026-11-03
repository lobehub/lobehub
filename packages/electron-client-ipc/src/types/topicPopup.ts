/**
 * Metadata describing a single topic popup window that is currently open.
 *
 * The main process maintains the source-of-truth registry and broadcasts
 * changes via the `topicPopupsChanged` event so main-window SPAs can
 * reactively hide the conversation and redirect users to the popup.
 */
export interface TopicPopupInfo {
  /**
   * For agent popups: the active agent id. Undefined when scope = 'group'.
   */
  agentId?: string;
  /**
   * For group popups: the active group id. Undefined when scope = 'agent'.
   */
  groupId?: string;
  /**
   * Electron BrowserWindow identifier that can be used with
   * `windows.focusTopicPopup` to raise and focus the popup.
   */
  identifier: string;
  scope: 'agent' | 'group';
  topicId: string;
}

export interface FocusTopicPopupParams {
  identifier: string;
}

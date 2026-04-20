export interface NavigationBroadcastEvents {
  /**
   * Ask renderer to close the active tab, or fall back to closing the window
   * when only one (or zero) tab is left. Triggered by Cmd/Ctrl+W on the main window.
   */
  closeCurrentTabOrWindow: () => void;

  /**
   * Ask renderer to create a new agent.
   * Triggered from the main process File menu.
   */
  createNewAgent: () => void;

  /**
   * Ask renderer to create a new agent group (group chat).
   * Triggered from the main process File menu.
   */
  createNewAgentGroup: () => void;

  /**
   * Ask renderer to create a new page.
   * Triggered from the main process File menu.
   */
  createNewPage: () => void;

  /**
   * Ask renderer to open a new tab based on the currently active tab's context.
   * Triggered by Cmd/Ctrl+T on the main window.
   */
  createNewTab: () => void;

  /**
   * Ask renderer to create a new topic (start a new conversation).
   * Triggered from the main process File menu.
   */
  createNewTopic: () => void;

  /**
   * Ask renderer to go back in navigation history.
   * Triggered from the main process menu.
   */
  historyGoBack: () => void;

  /**
   * Ask renderer to go forward in navigation history.
   * Triggered from the main process menu.
   */
  historyGoForward: () => void;

  /**
   * Ask renderer to navigate within the SPA without reloading the whole page.
   */
  navigate: (data: { path: string; replace?: boolean }) => void;
}

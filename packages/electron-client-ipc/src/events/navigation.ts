export interface NavigationBroadcastEvents {
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

export interface NavigationBroadcastEvents {
  /**
   * Ask renderer to navigate within the SPA without reloading the whole page.
   */
  navigate: (data: { path: string; replace?: boolean }) => void;
}

export interface AppMenuNode {
  accelerator?: string;
  checked?: boolean;
  children?: AppMenuNode[];
  enabled: boolean;
  id: string;
  label: string;
  /**
   * Electron menu role, when the item has one. Edit roles act on the focused
   * page element, so the renderer must restore that element before invoking.
   */
  role?: string;
  type: 'checkbox' | 'normal' | 'radio' | 'separator' | 'submenu';
}

export interface AppMenuNode {
  accelerator?: string;
  checked?: boolean;
  children?: AppMenuNode[];
  enabled: boolean;
  id: string;
  label: string;
  type: 'checkbox' | 'normal' | 'radio' | 'separator' | 'submenu';
}

import type { AppMenuNode } from '@lobechat/electron-client-ipc';
import type { MenuItemConstructorOptions } from 'electron';

export interface AppMenuItemSource {
  accelerator?: string | null;
  checked: boolean;
  enabled: boolean;
  id: string;
  label: string;
  role?: string | null;
  submenu?: { items: AppMenuItemSource[] };
  type: AppMenuNode['type'] | 'header' | 'palette';
  visible: boolean;
}

export const assignMenuIds = (template: MenuItemConstructorOptions[], prefix = 'app'): void => {
  for (const [index, item] of template.entries()) {
    if (item.type === 'separator') continue;

    item.id ??= `${prefix}-${index}`;
    if (Array.isArray(item.submenu)) assignMenuIds(item.submenu, item.id);
  }
};

const collapseSeparators = (nodes: AppMenuNode[]): AppMenuNode[] => {
  const collapsed: AppMenuNode[] = [];

  for (const node of nodes) {
    if (node.type !== 'separator') {
      collapsed.push(node);
      continue;
    }

    if (collapsed.length === 0 || collapsed.at(-1)?.type === 'separator') continue;
    collapsed.push(node);
  }

  while (collapsed.at(-1)?.type === 'separator') collapsed.pop();

  return collapsed;
};

export const serializeAppMenu = (items: AppMenuItemSource[]): AppMenuNode[] => {
  const nodes: AppMenuNode[] = [];

  for (const item of items) {
    if (item.visible === false || item.type === 'header' || item.type === 'palette') continue;

    if (item.type === 'separator') {
      nodes.push({ enabled: false, id: '', label: '', type: 'separator' });
      continue;
    }

    if (item.type === 'submenu') {
      const children = serializeAppMenu(item.submenu?.items ?? []);
      if (children.length === 0) continue;

      nodes.push({
        children,
        enabled: item.enabled,
        id: item.id,
        label: item.label,
        type: 'submenu',
      });
      continue;
    }

    const node: AppMenuNode = {
      enabled: item.enabled,
      id: item.id,
      label: item.label,
      type: item.type,
    };

    if (item.accelerator) node.accelerator = item.accelerator;
    if (item.role) node.role = item.role;
    if (item.type === 'checkbox' || item.type === 'radio') node.checked = item.checked;

    nodes.push(node);
  }

  return collapseSeparators(nodes);
};

import type { AppMenuNode } from '@lobechat/electron-client-ipc';
import type { DropdownItem } from '@lobehub/ui';

export const formatMenuAccelerator = (accelerator?: string): string | undefined => {
  if (!accelerator) return undefined;

  return accelerator
    .replaceAll('CommandOrControl', 'Ctrl')
    .replaceAll('CmdOrCtrl', 'Ctrl')
    .replaceAll('Plus', '+');
};

export const toAppMenuDropdownItems = (
  nodes: AppMenuNode[],
  invoke: (id: string, role?: string) => void,
): DropdownItem[] =>
  nodes.map((node, index) => {
    if (node.type === 'separator') return { key: `separator-${index}`, type: 'divider' };

    if (node.type === 'submenu') {
      return {
        children: toAppMenuDropdownItems(node.children ?? [], invoke),
        disabled: !node.enabled,
        key: node.id,
        label: node.label,
        openOnHover: true,
        type: 'submenu',
      };
    }

    const extra = formatMenuAccelerator(node.accelerator);
    const activate = () => {
      if (node.role) invoke(node.id, node.role);
      else invoke(node.id);
    };

    if (node.type === 'checkbox' || node.type === 'radio') {
      return {
        checked: Boolean(node.checked),
        closeOnClick: true,
        disabled: !node.enabled,
        extra,
        key: node.id,
        label: node.label,
        onCheckedChange: activate,
        type: 'checkbox',
      };
    }

    return {
      disabled: !node.enabled,
      extra,
      key: node.id,
      label: node.label,
      onClick: activate,
    };
  });

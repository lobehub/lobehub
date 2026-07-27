import type { NativeContextMenuItemTemplate, SFSymbol } from '@lobechat/electron-client-ipc';
import type { MenuInfo } from '@lobehub/ui';

import { isSubmenuShaped } from './canGoNative';
import type { NativeContextMenuItem } from './types';

export interface ToNativeTemplateResult {
  handlers: Map<string, () => void>;
  template: NativeContextMenuItemTemplate[];
}

const compact = <T extends Record<string, unknown>>(obj: T): T => {
  const result = {} as T;
  for (const key of Object.keys(obj) as (keyof T)[]) {
    if (obj[key] !== undefined) result[key] = obj[key];
  }
  return result;
};

const toLabel = (label: unknown): string | undefined =>
  typeof label === 'string' || typeof label === 'number' ? String(label) : undefined;

const toSublabel = (desc: unknown): string | undefined =>
  typeof desc === 'string' ? desc : undefined;

const buildMenuInfo = (key: string): MenuInfo =>
  ({
    domEvent: new MouseEvent('click'),
    key,
    keyPath: [key],
  }) as unknown as MenuInfo;

// FIXME: `danger` is dropped because Electron's MenuItem (as of 43) exposes no destructive/red styling API;
// once upstream adds one (same route as createMenuSymbol, electron/electron#48911), map danger here instead of dropping it
const baseFields = (item: {
  desc?: unknown;
  disabled?: boolean;
  label?: unknown;
  sfSymbol?: SFSymbol;
}) =>
  compact({
    enabled: item.disabled ? false : undefined,
    label: toLabel(item.label),
    sfSymbol: item.sfSymbol,
    sublabel: toSublabel(item.desc),
  });

const convertChildren = (
  items: NativeContextMenuItem[],
  parentId: string,
  handlers: Map<string, () => void>,
): NativeContextMenuItemTemplate[] =>
  items.flatMap((item, index) => convertItem(item, `${parentId}.${index}`, handlers));

const convertItem = (
  item: NativeContextMenuItem,
  id: string,
  handlers: Map<string, () => void>,
): NativeContextMenuItemTemplate[] => {
  if (item === null) return [];

  if (item.type === 'divider') {
    return [{ type: 'separator' }];
  }

  if (item.type === 'group') {
    const label = toLabel(item.label);
    const children = convertChildren(item.children ?? [], id, handlers);
    return label === undefined ? children : [{ label, type: 'header' }, ...children];
  }

  if (isSubmenuShaped(item)) {
    const children = 'children' in item ? (item.children ?? []) : [];
    return [
      {
        ...baseFields(item),
        submenu: convertChildren(children, id, handlers),
        type: 'submenu',
      },
    ];
  }

  if (item.type === 'switch') return [];

  const clickable = item as {
    checked?: boolean;
    defaultChecked?: boolean;
    key?: unknown;
    onCheckedChange?: (checked: boolean) => void;
    onClick?: (info: MenuInfo) => void;
  };

  if (item.type === 'checkbox') {
    const resolvedChecked = clickable.checked ?? clickable.defaultChecked;
    handlers.set(id, () => clickable.onCheckedChange?.(!resolvedChecked));
    return [
      {
        ...baseFields(item),
        ...(resolvedChecked !== undefined && { checked: resolvedChecked }),
        id,
        type: 'checkbox',
      },
    ];
  }

  const key = String(clickable.key ?? id);
  handlers.set(id, () => clickable.onClick?.(buildMenuInfo(key)));
  return [{ ...baseFields(item), id, type: 'normal' }];
};

export const toNativeTemplate = (items: NativeContextMenuItem[]): ToNativeTemplateResult => {
  const handlers = new Map<string, () => void>();
  const template = items.flatMap((item, index) => convertItem(item, String(index), handlers));
  return { handlers, template };
};

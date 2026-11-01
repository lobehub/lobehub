import type { LucideIcon } from 'lucide-react';
import { type ComponentType, lazy, useSyncExternalStore } from 'react';

interface DevDockItemBase {
  defaultPinned?: boolean;
  icon: LucideIcon;
  id: string;
  label: string;
}

export interface DevDockPanelItem extends DevDockItemBase {
  badge?: ComponentType;
  load: () => Promise<{ default: ComponentType }>;
  type: 'panel';
}

export interface DevDockActionItem extends DevDockItemBase {
  onTrigger: () => void;
  type: 'action';
}

export interface DevDockToggleItem extends DevDockItemBase {
  getChecked: () => boolean;
  onToggle: (checked: boolean) => void;
  subscribe: (listener: () => void) => () => void;
  type: 'toggle';
}

export interface DevDockSelectOption {
  label: string;
  value: string;
}

export interface DevDockSelectItem extends DevDockItemBase {
  getOptions: () => DevDockSelectOption[];
  getValue: () => string;
  onSelect: (value: string) => void;
  subscribe: (listener: () => void) => () => void;
  type: 'select';
}

export interface DevDockReadoutItem extends DevDockItemBase {
  load: () => Promise<{ default: ComponentType }>;
  slot: 'center' | 'right';
  type: 'readout';
}

export type DevDockItem =
  DevDockActionItem | DevDockPanelItem | DevDockReadoutItem | DevDockSelectItem | DevDockToggleItem;

export type DevDockLoadableItem = DevDockPanelItem | DevDockReadoutItem;

export type PinOverrides = Record<string, boolean>;

export const isItemPinned = (item: DevDockItem, overrides: PinOverrides): boolean =>
  overrides[item.id] ?? item.defaultPinned ?? false;

export interface DevDockBarLayout {
  center?: DevDockReadoutItem;
  right: Exclude<DevDockItem, DevDockPanelItem>[];
  tabs: DevDockPanelItem[];
}

/**
 * An unpinned panel keeps a temporary tab while it is the active panel, so the
 * bar always shows which panel is open.
 */
export const selectBarLayout = (
  items: DevDockItem[],
  overrides: PinOverrides,
  activePanelId: string | null,
): DevDockBarLayout => {
  const pinned = (item: DevDockItem) => isItemPinned(item, overrides);

  return {
    center: items.find(
      (item): item is DevDockReadoutItem =>
        item.type === 'readout' && item.slot === 'center' && pinned(item),
    ),
    right: items.filter(
      (item): item is Exclude<DevDockItem, DevDockPanelItem> =>
        item.type !== 'panel' && (item.type !== 'readout' || item.slot === 'right') && pinned(item),
    ),
    tabs: items.filter(
      (item): item is DevDockPanelItem =>
        item.type === 'panel' && (pinned(item) || item.id === activePanelId),
    ),
  };
};

const items: DevDockItem[] = [];
let snapshot: DevDockItem[] = [];
const listeners = new Set<() => void>();

export const registerDevDockItems = (next: DevDockItem[]) => {
  let changed = false;
  for (const item of next) {
    if (items.some((existing) => existing.id === item.id)) continue;
    items.push(item);
    changed = true;
  }
  if (!changed) return;
  snapshot = [...items];
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const getDevDockItemsSnapshot = (): DevDockItem[] => snapshot;

export const useDevDockItems = (): DevDockItem[] =>
  useSyncExternalStore(subscribe, getDevDockItemsSnapshot, getDevDockItemsSnapshot);

const componentCache = new Map<string, ComponentType>();

export const getItemComponent = (item: DevDockLoadableItem): ComponentType => {
  let component = componentCache.get(item.id);
  if (!component) {
    component = lazy(item.load);
    componentCache.set(item.id, component);
  }
  return component;
};

import type { LucideIcon } from 'lucide-react';
import { type ComponentType, lazy, useSyncExternalStore } from 'react';

export interface DevDockPanelItem {
  badge?: ComponentType;
  icon: LucideIcon;
  id: string;
  load: () => Promise<{ default: ComponentType }>;
  title: string;
  type: 'panel';
}

export interface DevDockWidgetItem {
  id: string;
  load: () => Promise<{ default: ComponentType }>;
  placement: 'left' | 'right';
  type: 'widget';
}

export type DevDockItem = DevDockPanelItem | DevDockWidgetItem;

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
  useSyncExternalStore(subscribe, getDevDockItemsSnapshot);

const componentCache = new Map<string, ComponentType>();

export const getItemComponent = (item: DevDockItem): ComponentType => {
  let component = componentCache.get(item.id);
  if (!component) {
    component = lazy(item.load);
    componentCache.set(item.id, component);
  }
  return component;
};

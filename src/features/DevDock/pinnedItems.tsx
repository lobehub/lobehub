'use client';

import { type DropdownItem, DropdownMenu, Switch } from '@lobehub/ui/base-ui';
import { Component, memo, type PropsWithChildren, Suspense, useSyncExternalStore } from 'react';

import {
  type DevDockActionItem,
  type DevDockLoadableItem,
  type DevDockSelectItem,
  type DevDockToggleItem,
  getItemComponent,
} from './registry';
import BarButton, { barButtonStyles } from './widgets/BarButton';

class WidgetBoundary extends Component<PropsWithChildren, { failed?: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export const WidgetSlot = memo<{ item: DevDockLoadableItem }>(({ item }) => {
  const Widget = getItemComponent(item);
  return (
    <WidgetBoundary>
      <Suspense fallback={null}>
        <Widget />
      </Suspense>
    </WidgetBoundary>
  );
});

WidgetSlot.displayName = 'DevDockWidgetSlot';

export const PinnedAction = memo<{ item: DevDockActionItem }>(({ item }) => (
  <BarButton icon={item.icon} label={item.label} onClick={item.onTrigger} />
));

PinnedAction.displayName = 'DevDockPinnedAction';

export const PinnedToggle = memo<{ item: DevDockToggleItem }>(({ item }) => {
  const checked = useSyncExternalStore(item.subscribe, item.getChecked, item.getChecked);
  return (
    <label style={{ alignItems: 'center', cursor: 'pointer', display: 'inline-flex', gap: 5 }}>
      <Switch checked={checked} size={'small'} onChange={item.onToggle} />
      <span>{item.label}</span>
    </label>
  );
});

PinnedToggle.displayName = 'DevDockPinnedToggle';

export const PinnedSelect = memo<{ item: DevDockSelectItem }>(({ item }) => {
  const value = useSyncExternalStore(item.subscribe, item.getValue, item.getValue);
  const Icon = item.icon;

  const buildItems = (): DropdownItem[] =>
    item.getOptions().map((option) => ({
      checked: value === option.value,
      closeOnClick: true,
      key: option.value,
      label: option.label,
      onCheckedChange: (checked: boolean) => {
        if (checked) item.onSelect(option.value);
      },
      type: 'checkbox' as const,
    }));

  return (
    <DropdownMenu
      items={buildItems}
      placement={'topRight'}
      popupProps={{ style: { maxHeight: 360, minWidth: 180, overflow: 'auto' } }}
    >
      <span className={barButtonStyles.button} title={item.label}>
        <Icon size={11} />
        <span>{value}</span>
      </span>
    </DropdownMenu>
  );
});

PinnedSelect.displayName = 'DevDockPinnedSelect';

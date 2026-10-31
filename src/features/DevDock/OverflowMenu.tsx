'use client';

import { type DropdownItem, DropdownMenu } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Ellipsis, Pin } from 'lucide-react';
import { memo } from 'react';

import { sx } from '@/styles/sx';

import popupStyles from './OverflowMenu.module.css';
import {
  type DevDockItem,
  type DevDockSelectItem,
  isItemPinned,
  useDevDockItems,
} from './registry';
import { useDevDockStore } from './store';

const styles = stylex.create({
  pinButton: {
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '18px',
    height: '18px',
    padding: 0,
    borderStyle: 'none',
    borderRadius: '4px',
    color: {
      'default': cssVar.colorTextQuaternary,
      ':hover': cssVar.colorText,
      '[data-pinned="true"]': cssVar.colorText,
    },
    backgroundColor: { 'default': 'transparent', ':hover': cssVar.colorFillTertiary },
    backgroundImage: 'none',
  },
  submenuLabel: { display: 'inline-flex', gap: '8px', alignItems: 'center' },
  trigger: {
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '20px',
    height: '20px',
    borderStyle: 'none',
    borderRadius: '4px',
    color: {
      'default': cssVar.colorTextTertiary,
      ':hover': cssVar.colorText,
      '[data-popup-open]': cssVar.colorText,
    },
    backgroundColor: {
      'default': 'transparent',
      ':hover': cssVar.colorFillTertiary,
      '[data-popup-open]': cssVar.colorFillTertiary,
    },
    backgroundImage: 'none',
  },
  valueHint: {
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '10px',
    color: cssVar.colorTextTertiary,
  },
});

const PinToggle = memo<{ item: DevDockItem }>(({ item }) => {
  const pinned = useDevDockStore((s) => isItemPinned(item, s.pinOverrides));
  const setPinned = useDevDockStore((s) => s.setPinned);
  return (
    <button
      {...sx([styles.pinButton], popupStyles.pin)}
      data-pinned={pinned}
      title={pinned ? 'Unpin from bar' : 'Pin to bar'}
      type={'button'}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setPinned(item.id, !pinned);
      }}
    >
      <Pin fill={pinned ? 'currentColor' : 'none'} size={11} />
    </button>
  );
});

PinToggle.displayName = 'DevDockPinToggle';

const buildSelectSubmenu = (item: DevDockSelectItem): DropdownItem => ({
  children: item.getOptions().map((option) => ({
    checked: item.getValue() === option.value,
    closeOnClick: true,
    key: option.value,
    label: option.label,
    onCheckedChange: (checked: boolean) => {
      if (checked) item.onSelect(option.value);
    },
    type: 'checkbox' as const,
  })),
  icon: item.icon,
  key: item.id,
  label: (
    <span {...stylex.props(styles.submenuLabel)}>
      {item.label}
      <span {...stylex.props(styles.valueHint)}>{item.getValue()}</span>
      <PinToggle item={item} />
    </span>
  ),
  type: 'submenu' as const,
});

const OverflowMenu = memo(() => {
  const items = useDevDockItems();

  const buildItems = (): DropdownItem[] => {
    const { setPinned, togglePanel } = useDevDockStore.getState();
    const pinned = (item: DevDockItem) =>
      isItemPinned(item, useDevDockStore.getState().pinOverrides);

    const groups: DropdownItem[] = [];

    const panels = items.filter((item) => item.type === 'panel');
    if (panels.length > 0)
      groups.push({
        children: panels.map((item) => ({
          extra: <PinToggle item={item} />,
          icon: item.icon,
          key: item.id,
          label: item.label,
          onClick: () => togglePanel(item.id),
        })),
        label: 'Panels',
        type: 'group' as const,
      });

    const toggles = items.filter((item) => item.type === 'toggle');
    if (toggles.length > 0)
      groups.push({
        children: toggles.map((item) => ({
          closeOnClick: false,
          defaultChecked: item.getChecked(),
          extra: <PinToggle item={item} />,
          icon: item.icon,
          key: item.id,
          label: item.label,
          onCheckedChange: item.onToggle,
          type: 'switch' as const,
        })),
        label: 'Toggles',
        type: 'group' as const,
      });

    const actions = items.filter((item) => item.type === 'action');
    if (actions.length > 0)
      groups.push({
        children: actions.map((item) => ({
          extra: <PinToggle item={item} />,
          icon: item.icon,
          key: item.id,
          label: item.label,
          onClick: item.onTrigger,
        })),
        label: 'Actions',
        type: 'group' as const,
      });

    const readouts = items.filter((item) => item.type === 'readout');
    if (readouts.length > 0)
      groups.push({
        children: readouts.map((item) => ({
          closeOnClick: false,
          extra: <PinToggle item={item} />,
          icon: item.icon,
          key: item.id,
          label: item.label,
          onClick: () => setPinned(item.id, !pinned(item)),
        })),
        label: 'Metrics',
        type: 'group' as const,
      });

    const selects = items.filter((item) => item.type === 'select');
    if (selects.length > 0) {
      groups.push({ type: 'divider' as const }, ...selects.map(buildSelectSubmenu));
    }

    return groups;
  };

  return (
    <DropdownMenu
      items={buildItems}
      placement={'topRight'}
      popupProps={{ className: popupStyles.popup }}
    >
      <span {...stylex.props(styles.trigger)} title={'More tools'}>
        <Ellipsis size={13} />
      </span>
    </DropdownMenu>
  );
});

OverflowMenu.displayName = 'DevDockOverflowMenu';

export default OverflowMenu;

'use client';

import { type DropdownItem, DropdownMenu } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { Ellipsis, Pin } from 'lucide-react';
import { memo } from 'react';

import {
  type DevDockItem,
  type DevDockSelectItem,
  isItemPinned,
  useDevDockItems,
} from './registry';
import { useDevDockStore } from './store';

const PIN_CLASS = 'devdock-pin';

const styles = createStaticStyles(({ css }) => ({
  pinButton: css`
    cursor: pointer;

    display: inline-flex;
    align-items: center;
    justify-content: center;

    width: 18px;
    height: 18px;
    padding: 0;
    border: none;
    border-radius: 4px;

    color: ${cssVar.colorTextQuaternary};

    background: transparent;

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillTertiary};
    }

    &[data-pinned='true'] {
      color: ${cssVar.colorText};
    }
  `,
  popup: css`
    min-width: 224px;

    .${PIN_CLASS} {
      opacity: 0;
    }

    [role^='menuitem']:hover .${PIN_CLASS},
    .${PIN_CLASS}:focus-visible,
    .${PIN_CLASS}[data-pinned='true'] {
      opacity: 1;
    }
  `,
  submenuLabel: css`
    display: inline-flex;
    gap: 8px;
    align-items: center;
  `,
  trigger: css`
    cursor: pointer;

    display: inline-flex;
    align-items: center;
    justify-content: center;

    width: 20px;
    height: 20px;
    border: none;
    border-radius: 4px;

    color: ${cssVar.colorTextTertiary};

    background: transparent;

    &:hover,
    &[data-popup-open] {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillTertiary};
    }
  `,
  valueHint: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: 10px;
    color: ${cssVar.colorTextTertiary};
  `,
}));

const PinToggle = memo<{ item: DevDockItem }>(({ item }) => {
  const pinned = useDevDockStore((s) => isItemPinned(item, s.pinOverrides));
  const setPinned = useDevDockStore((s) => s.setPinned);
  return (
    <button
      className={cx(PIN_CLASS, styles.pinButton)}
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
    <span className={styles.submenuLabel}>
      {item.label}
      <span className={styles.valueHint}>{item.getValue()}</span>
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
      popupProps={{ className: styles.popup }}
    >
      <span className={styles.trigger} title={'More tools'}>
        <Ellipsis size={13} />
      </span>
    </DropdownMenu>
  );
});

OverflowMenu.displayName = 'DevDockOverflowMenu';

export default OverflowMenu;

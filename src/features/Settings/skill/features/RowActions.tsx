'use client';

import { ActionIcon, Button, type DropdownItem, DropdownMenu, Icon } from '@lobehub/ui';
import { MoreHorizontalIcon, PanelRightOpen, Plus } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

interface RowAddActionProps {
  disabled?: boolean;
  /** Why it is disabled; replaces the action name in the tooltip. */
  disabledReason?: string;
  /** Accessible name and tooltip, e.g. "Connect" or "Install". */
  label: string;
  loading?: boolean;
  onClick: () => void;
  showLabel?: boolean;
}

/**
 * The page row's one-step action for an entry that is not added yet: a quiet `+`
 * that connects or installs in place. Once added it becomes {@link RowMoreMenu}.
 */
export const RowAddAction = memo<RowAddActionProps>(
  ({ disabled, disabledReason, label, loading, onClick, showLabel }) => {
    const handleClick = (event: React.MouseEvent) => {
      event.stopPropagation();
      onClick();
    };

    if (showLabel)
      return (
        <Button
          disabled={disabled || loading}
          icon={Plus}
          loading={loading}
          size={'small'}
          title={disabled ? disabledReason : undefined}
          onClick={handleClick}
        >
          {label}
        </Button>
      );

    return (
      <ActionIcon
        aria-label={label}
        disabled={disabled || loading}
        icon={Plus}
        loading={loading}
        title={disabled && disabledReason ? disabledReason : label}
        onClick={handleClick}
      />
    );
  },
);

RowAddAction.displayName = 'RowAddAction';

type MenuItems = DropdownItem[];

interface RowMoreMenuProps {
  /** Lifecycle items after "View details", e.g. Disconnect / Uninstall. */
  items?: MenuItems;
  onOpenDetail?: () => void;
}

/**
 * The page row's manage menu for an added entry: open the detail page, plus the
 * row's lifecycle actions (each keeps its own confirmation).
 */
export const RowMoreMenu = memo<RowMoreMenuProps>(({ items = [], onOpenDetail }) => {
  const { t } = useTranslation('setting');
  const menuItems: MenuItems = [
    ...(onOpenDetail
      ? [
          {
            icon: <Icon icon={PanelRightOpen} />,
            key: 'details',
            label: t('connectorMarket.action.details'),
            onClick: onOpenDetail,
          },
        ]
      : []),
    ...(onOpenDetail && items.length > 0 ? [{ type: 'divider' as const }] : []),
    ...items,
  ];

  return (
    // The row itself opens the detail: keep menu clicks (React bubbles them out
    // of the portalled popup too) from reaching it.
    // lobe-design-ignore LOBE-DIV-CLICK: not a control; only stops propagation to the row
    <span style={{ display: 'inline-flex' }} onClick={(event) => event.stopPropagation()}>
      <DropdownMenu items={menuItems} placement={'bottomRight'}>
        <ActionIcon
          aria-label={t('connectorMarket.action.manage')}
          icon={MoreHorizontalIcon}
          title={t('connectorMarket.action.manage')}
        />
      </DropdownMenu>
    </span>
  );
});

RowMoreMenu.displayName = 'RowMoreMenu';

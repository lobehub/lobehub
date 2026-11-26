import { Popover } from '@lobehub/ui';
import { WrenchIcon } from 'lucide-react';
import { memo, type ReactNode, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { type ActionDropdownMenuItems } from '../components/ActionDropdown';
import SubmenuChevron from '../components/SubmenuChevron';
import { useDetailPopoverState } from '../components/useDetailPopoverState';
import { useControls as useToolsControls } from '../Tools/useControls';

type DropdownItemWithPopover = NonNullable<ActionDropdownMenuItems>[number] & {
  label?: ReactNode;
  popoverContent?: unknown;
};

interface PopoverLabelProps {
  disabled?: boolean;
  label: ReactNode;
  popoverContent: ReactNode;
}

const PopoverLabel = memo<PopoverLabelProps>(({ disabled, label, popoverContent }) => {
  const { close, onOpenChange, open } = useDetailPopoverState(disabled);
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const rowAnchorRef = useMemo(
    () => ({
      get current() {
        const wrapper = wrapperRef.current;
        return (wrapper?.closest('[role="menuitem"]') as HTMLElement | null) ?? wrapper;
      },
    }),
    [],
  );

  return (
    <Popover
      arrow={false}
      content={popoverContent}
      disabled={disabled}
      mouseEnterDelay={0.25}
      open={open}
      placement={'rightTop'}
      positionerProps={{ anchor: rowAnchorRef, sideOffset: 8 }}
      styles={{ content: { padding: 0 }, root: { pointerEvents: 'none' } }}
      onOpenChange={onOpenChange}
    >
      <span
        ref={wrapperRef}
        style={{ display: 'block', width: '100%' }}
        onClickCapture={close}
        onContextMenuCapture={close}
      >
        {label}
      </span>
    </Popover>
  );
});

PopoverLabel.displayName = 'PopoverLabel';

const stripPopoverContent = (
  items?: ActionDropdownMenuItems,
  detailPopoverDisabled?: boolean,
): ActionDropdownMenuItems =>
  items?.map((item) => {
    if (!item) return item;
    if ('type' in item && item.type === 'divider') return item;

    const nextItem = { ...(item as DropdownItemWithPopover) };
    const popoverContent = nextItem.popoverContent;
    delete nextItem.popoverContent;

    if ('children' in nextItem && nextItem.children) {
      return {
        ...nextItem,
        children: stripPopoverContent(nextItem.children, detailPopoverDisabled),
      } as ActionDropdownMenuItems[number];
    }

    if ('label' in nextItem && popoverContent) {
      nextItem.label = (
        <PopoverLabel
          disabled={detailPopoverDisabled}
          label={nextItem.label}
          popoverContent={popoverContent as ReactNode}
        />
      );
    }

    return nextItem;
  }) ?? [];

/**
 * Inline Tools submenu fallback for desktop popup chats (`/popup/*`), where
 * `WorkingSidebar` is not mounted.
 */
export const usePopupToolsMenuItem = (closeDropdown: () => void) => {
  const { t } = useTranslation('setting');
  const { isPolicyMenuOpen, marketFooter, marketHeader, marketItems } = useToolsControls({
    closeDropdown,
  });

  return useMemo(
    () =>
      ({
        children: stripPopoverContent(marketItems as ActionDropdownMenuItems, isPolicyMenuOpen),
        extra: <SubmenuChevron />,
        footer: marketFooter,
        header: marketHeader,
        icon: WrenchIcon,
        key: 'tools',
        label: t('tools.picker.title'),
      }) as ActionDropdownMenuItems[number],
    [isPolicyMenuOpen, marketFooter, marketHeader, marketItems, t],
  );
};

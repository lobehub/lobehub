'use client';

import { type ActionIconProps, type PopoverTrigger } from '@lobehub/ui';
import { ActionIcon } from '@lobehub/ui';
import { isUndefined } from 'es-toolkit/compat';
import { memo } from 'react';
import useMergeState from 'use-merge-value';

import { useServerConfigStore } from '@/store/serverConfig';

import { useActionBarContext } from '../context';
import { type ActionDropdownProps } from './ActionDropdown';
import ActionDropdown from './ActionDropdown';
import { type ActionPopoverProps } from './ActionPopover';
import ActionPopover from './ActionPopover';

interface ActionProps extends Omit<ActionIconProps, 'popover'> {
  dropdown?: Omit<ActionDropdownProps, 'children'>;
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
  popover?: ActionPopoverProps;
  showTooltip?: boolean;
  trigger?: PopoverTrigger;
}

const Action = memo<ActionProps>(
  ({
    showTooltip,
    loading,
    icon,
    title,
    dropdown,
    popover,
    open,
    onOpenChange,
    trigger,
    disabled,
    onClick,
    ...rest
  }) => {
    const [show, setShow] = useMergeState(false, {
      onChange: onOpenChange,
      value: open,
    });
    const mobile = useServerConfigStore((s) => s.isMobile);
    const { dropdownPlacement } = useActionBarContext();
    const iconNode = (
      <ActionIcon
        disabled={disabled}
        icon={icon}
        loading={loading}
        title={
          isUndefined(showTooltip) ? (mobile ? undefined : title) : showTooltip ? title : undefined
        }
        tooltipProps={{
          placement: 'bottom',
        }}
        onClick={(e) => {
          if (onClick) return onClick(e);
          setShow(true);
        }}
        {...rest}
        size={{
          blockSize: 36,
          size: 20,
        }}
      />
    );

    if (disabled) return iconNode;

    if (dropdown)
      return (
        <ActionDropdown
          open={show}
          trigger={trigger}
          onOpenChange={setShow}
          {...dropdown}
          minWidth={mobile ? '100%' : dropdown.minWidth}
          placement={mobile ? 'top' : (dropdownPlacement ?? dropdown.placement)}
        >
          {iconNode}
        </ActionDropdown>
      );
    if (popover)
      return (
        <ActionPopover
          open={show}
          trigger={trigger}
          onOpenChange={setShow}
          {...popover}
          minWidth={mobile ? '100%' : popover.minWidth}
          placement={mobile ? 'top' : (dropdownPlacement ?? popover.placement)}
        >
          {iconNode}
        </ActionPopover>
      );

    return iconNode;
  },
);

export default Action;

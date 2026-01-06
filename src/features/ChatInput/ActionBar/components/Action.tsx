'use client';

import { ActionIcon, type ActionIconProps } from '@lobehub/ui';
import { isUndefined } from 'es-toolkit/compat';
import { memo } from 'react';
import useMergeState from 'use-merge-value';

import { useServerConfigStore } from '@/store/serverConfig';

import { useActionBarContext } from '../context';
import ActionDropdown, { type ActionDropdownProps } from './ActionDropdown';
import ActionPopover, { type ActionPopoverProps } from './ActionPopover';

interface ActionProps extends Omit<ActionIconProps, 'popover'> {
  dropdown?: ActionDropdownProps;
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
  popover?: ActionPopoverProps;
  showTooltip?: boolean;
  trigger?: ActionDropdownProps['trigger'];
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
        onClick={(e) => {
          if (onClick) return onClick(e);
          setShow(true);
        }}
        title={
          isUndefined(showTooltip) ? (mobile ? undefined : title) : showTooltip ? title : undefined
        }
        tooltipProps={{
          placement: 'bottom',
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
          onOpenChange={setShow}
          open={show}
          trigger={trigger}
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
          onOpenChange={setShow}
          open={show}
          trigger={
            Array.isArray(trigger)
              ? (trigger.filter((t) => t !== 'contextMenu') as ('click' | 'hover')[])
              : trigger
          }
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

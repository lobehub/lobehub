'use client';

import type { DeviceListItem } from '@lobechat/types';
import { Popover } from '@lobehub/ui';
import type { ReactElement } from 'react';

import DeviceHoverPanel from '@/features/DeviceManager/DeviceHoverPanel';

/** Long enough that sweeping the pointer down the list doesn't flash a panel per row. */
const DETAIL_OPEN_DELAY_MS = 300;

/**
 * Rows sit ~5px inside the menu edge, so the default 6px offset leaves the
 * panels touching. 12px matches the model provider submenu (~7px visible gap).
 */
const DETAIL_SIDE_OFFSET = 12;

interface DeviceDetailPopoverProps {
  children: ReactElement;
  device: DeviceListItem;
}

/**
 * Opens a device's details beside an execution environment menu while its row
 * is hovered — offline rows too, since "why can't I pick this" is exactly when
 * the specs and last-seen time matter.
 */
const DeviceDetailPopover = ({ children, device }: DeviceDetailPopoverProps) => (
  <Popover
    arrow={false}
    content={<DeviceHoverPanel device={device} />}
    openDelay={DETAIL_OPEN_DELAY_MS}
    placement={'rightTop'}
    positionerProps={{ sideOffset: DETAIL_SIDE_OFFSET }}
    styles={{ content: { padding: 4 } }}
    trigger={'hover'}
  >
    {children}
  </Popover>
);

export default DeviceDetailPopover;

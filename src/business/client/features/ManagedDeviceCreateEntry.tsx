'use client';

import type { DeviceScope, DeviceVisibility } from '@lobechat/types';
import { memo } from 'react';

export interface ManagedDeviceCreateEntryProps {
  /** Where the device list renders the entry: its toolbar, or its empty state. */
  placement: 'empty' | 'toolbar';
  /** Which device pool the list manages. */
  scope: DeviceScope;
  /** Workspace scope only: the visibility tab the list is filtered to. */
  visibility?: DeviceVisibility;
}

/**
 * An entry for creating a managed cloud device, shown by the device list next
 * to its connect actions. The list renders it only while the
 * `managed_cloud_device` flag is on for the user.
 *
 * Nothing in the open-source build: it has no managed device provider.
 * Downstream builds override this module through their own `@/business/...`
 * mapping.
 */
const ManagedDeviceCreateEntry = memo<ManagedDeviceCreateEntryProps>(() => null);

ManagedDeviceCreateEntry.displayName = 'ManagedDeviceCreateEntry';

export default ManagedDeviceCreateEntry;

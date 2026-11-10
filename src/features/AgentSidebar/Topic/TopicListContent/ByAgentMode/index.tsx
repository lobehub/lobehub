'use client';

import { useDeviceList } from '@/store/device';

import GroupedAccordion from '../GroupedAccordion';
import GroupItem from './GroupItem';

/** How often the device list is re-read while this list is on screen. */
export const DEVICE_PRESENCE_POLL_MS = 30_000;

const ByAgentMode = () => {
  // The presence dots on the group headers read this same device list. One
  // poller here keeps them live — a device that drops while the sidebar stays
  // open turns gray without a refocus — instead of every dot polling on its own.
  useDeviceList({ refreshInterval: DEVICE_PRESENCE_POLL_MS });

  return <GroupedAccordion GroupItem={GroupItem} />;
};

export default ByAgentMode;

'use client';

import { memo } from 'react';

import ChannelList from '@/features/Channels/ChannelList';

import { useSidebarSectionMenuItems } from './useSidebarSectionMenuItems';

interface ChannelsProps {
  itemKey: string;
}

/** The home sidebar's Channels section, with the same layout menu as the other sections. */
const Channels = memo<ChannelsProps>(({ itemKey }) => {
  const layoutMenuItems = useSidebarSectionMenuItems(itemKey);

  return <ChannelList layoutMenuItems={layoutMenuItems} />;
});

Channels.displayName = 'HomeSidebarChannels';

export default Channels;

import { useInterfaceDensity } from '@/styles/density';

export const CHANNEL_MESSAGE_LAYOUT = {
  compact: { avatarSize: 28, headerGap: 2, indent: 40, paddingBlock: 4 },
  loose: { avatarSize: 36, headerGap: 4, indent: 48, paddingBlock: 8 },
} as const;

export const useChannelMessageLayout = () => CHANNEL_MESSAGE_LAYOUT[useInterfaceDensity()];

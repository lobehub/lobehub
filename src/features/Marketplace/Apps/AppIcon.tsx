import { Avatar, Icon } from '@lobehub/ui';

import { PlatformBrandIcon } from '@/features/Messenger/constants';

import type { MarketplaceApp } from './catalog';

export const AppIcon = ({ app, size = 24 }: { app: MarketplaceApp; size?: number }) => {
  if (app.channel) return <PlatformBrandIcon platform={app.channel.id} size={size} />;
  const icon = app.tool?.type === 'lobehub' ? app.tool.provider.icon : app.tool?.serverType.icon;
  if (!icon) return null;
  return typeof icon === 'string' ? (
    <Avatar avatar={icon} size={size} />
  ) : (
    <Icon icon={icon} size={size} />
  );
};

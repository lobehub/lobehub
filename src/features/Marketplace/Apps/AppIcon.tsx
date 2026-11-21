import { Avatar, Icon } from '@lobehub/ui';

import { PlatformBrandIcon } from '@/features/Messenger/constants';

import type { MarketplaceApp } from './catalog';

export const AppIcon = ({ app }: { app: MarketplaceApp }) => {
  if (app.channel) return <PlatformBrandIcon platform={app.channel.id} size={24} />;
  const icon = app.tool?.type === 'lobehub' ? app.tool.provider.icon : app.tool?.serverType.icon;
  if (!icon) return null;
  return typeof icon === 'string' ? (
    <Avatar avatar={icon} size={24} />
  ) : (
    <Icon icon={icon} size={24} />
  );
};

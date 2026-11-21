import { Avatar } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';

import { PlatformBrandIcon } from '@/features/Messenger/constants';
import { useIsDark } from '@/hooks/useIsDark';

import type { MarketplaceApp } from './catalog';

export const AppIcon = ({ app, size = 24 }: { app: MarketplaceApp; size?: number }) => {
  const isDark = useIsDark();
  if (app.channel) return <PlatformBrandIcon platform={app.channel.id} size={size} />;
  const BrandIcon =
    app.tool?.type === 'lobehub' ? app.tool.provider.icon : app.tool?.serverType.icon;
  if (!BrandIcon) return null;
  if (typeof BrandIcon === 'string')
    return <Avatar alt={app.name} avatar={BrandIcon} size={size} />;
  if (app.id === 'posthog') {
    const avatar = isDark
      ? 'https://brand.posthog.com/logo/posthog-logomark-square-white.svg'
      : 'https://brand.posthog.com/logo/posthog-logomark-square.svg';
    return <Avatar alt={app.name} avatar={avatar} size={size} />;
  }

  // Simple Icons supplies the brand color. Keep monochrome marks legible on dark surfaces.
  const color = isDark && app.id !== 'linear' ? cssVar.colorText : 'default';
  return <BrandIcon color={color} size={size} title={app.name} />;
};

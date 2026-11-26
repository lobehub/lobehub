'use client';

import { type IconType } from '@icons-pack/react-simple-icons';
import { COMPOSIO_APP_TYPES, LOBEHUB_SKILL_PROVIDERS } from '@lobechat/const';
import { type UserCredSummary } from '@lobechat/types';
import { Avatar, Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import { memo } from 'react';

import { CRED_TYPE_ICONS } from './credTypes';

/** Lowercase letters and digits only, so `GitHub`, `GITHUB` and `google-calendar` meet. */
const slug = (value?: string) => value?.toLowerCase().replaceAll(/[^\da-z]/g, '') ?? '';

/** Every site with a known logo, by slug; a LobeHub connector wins over a Composio app. */
const SITE_ICONS = new Map<string, string | IconType>([
  ...COMPOSIO_APP_TYPES.map((app) => [slug(app.identifier), app.icon] as const),
  ...LOBEHUB_SKILL_PROVIDERS.map((provider) => [slug(provider.id), provider.icon] as const),
  ['x', LOBEHUB_SKILL_PROVIDERS.find((provider) => provider.id === 'twitter')!.icon],
]);

const findSite = (value?: string) => SITE_ICONS.get(slug(value));

/**
 * The website a vault item belongs to, when it names one: an OAuth item's
 * provider, else the item's key (`notion`) or its first word (`GITHUB_TOKEN`).
 */
export const credSiteIcon = (cred: UserCredSummary) =>
  (cred.type === 'oauth' ? findSite(cred.oauthProvider) : undefined) ??
  findSite(cred.key) ??
  findSite(cred.key.split(/[_.-]/)[0]);

interface CredIconProps {
  /** Size of the OAuth account avatar fallback; defaults to 1.5 × `size`. */
  avatarSize?: number;
  cred: UserCredSummary;
  size?: number;
}

/**
 * A vault item's icon: the website's logo when it belongs to one, the OAuth
 * account avatar when the provider is unknown, else the type icon.
 */
const CredIcon = memo<CredIconProps>(({ avatarSize, cred, size = 18 }) => {
  const site = credSiteIcon(cred);

  if (typeof site === 'string') return <Avatar avatar={site} shape={'square'} size={size} />;
  if (site) return <Icon fill={cssVar.colorText} icon={site} size={size} />;
  if (cred.type === 'oauth' && cred.oauthAvatar)
    return <Avatar avatar={cred.oauthAvatar} size={avatarSize ?? Math.round(size * 1.5)} />;

  return <Icon color={cssVar.colorTextSecondary} icon={CRED_TYPE_ICONS[cred.type]} size={size} />;
});

CredIcon.displayName = 'CredIcon';

export default CredIcon;

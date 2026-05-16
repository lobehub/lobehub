import { BRANDING_LOGO_URL } from '@lobechat/business-const';
import type { MetaData } from '@lobechat/types';

export const DEFAULT_AVATAR = '/avatars/agent-default.png';
export const DEFAULT_USER_AVATAR = '😀';
export const DEFAULT_SUPERVISOR_AVATAR = '🎙️';
export const DEFAULT_SUPERVISOR_ID = 'supervisor';
export const DEFAULT_BACKGROUND_COLOR = undefined;
export const DEFAULT_AGENT_META: MetaData = {};

const getPublicBrandingEnv = (key: string) => {
  const value = process.env[key];
  if (!value) return;

  const trimmed = value.trim();
  return trimmed || undefined;
};

const DEFAULT_BRANDING_LOGO = '/icons/icon-bot-new.svg';
const DEFAULT_BRANDING_ASSISTANT_AVATAR = '/icons/icon-bot-new.svg';
const DEFAULT_BRANDING_USER_AVATAR = '/icons/icon-bot-192.png';

const brandingLogo =
  getPublicBrandingEnv('NEXT_PUBLIC_BRANDING_LOGO_URL') ||
  getPublicBrandingEnv('BRANDING_LOGO_URL') ||
  BRANDING_LOGO_URL ||
  DEFAULT_BRANDING_LOGO;

export const DEFAULT_INBOX_AVATAR =
  getPublicBrandingEnv('NEXT_PUBLIC_BRANDING_ASSISTANT_AVATAR_URL') ||
  getPublicBrandingEnv('BRANDING_ASSISTANT_AVATAR_URL') ||
  brandingLogo ||
  DEFAULT_BRANDING_ASSISTANT_AVATAR;

export const DEFAULT_USER_AVATAR_URL =
  getPublicBrandingEnv('NEXT_PUBLIC_BRANDING_USER_AVATAR_URL') ||
  getPublicBrandingEnv('BRANDING_USER_AVATAR_URL') ||
  getPublicBrandingEnv('NEXT_PUBLIC_BRANDING_APP_ICON_192_URL') ||
  getPublicBrandingEnv('BRANDING_APP_ICON_192_URL') ||
  brandingLogo ||
  DEFAULT_BRANDING_USER_AVATAR;

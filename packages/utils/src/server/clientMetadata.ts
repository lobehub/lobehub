import { CLIENT_VERSION_HEADER } from '@lobechat/const';

export type ClientType = 'desktop' | 'mobile' | 'unknown' | 'web';
export type MobileClientPlatform = 'android' | 'ios';

export interface ClientMetadata {
  platform?: MobileClientPlatform;
  type: ClientType;
  version?: string;
}

const MAX_CLIENT_VERSION_LENGTH = 128;
const DESKTOP_USER_AGENT_PATTERN = /\bLobeHub Desktop\/(\S+)/i;
const MOBILE_USER_AGENT_PATTERN = /\bLobeHub-Mobile\/(android|ios)-v(\S+)/i;
const LEGACY_IOS_USER_AGENT_PATTERNS = [/\bLobeHub-iOS\/(\S+)/i, /\bLobeHub\/(\S+)\s+CFNetwork\//i];

const normalizeVersion = (version: string | null | undefined) => {
  const normalizedVersion = version?.trim();

  if (!normalizedVersion || normalizedVersion.length > MAX_CLIENT_VERSION_LENGTH) return;

  return normalizedVersion;
};

export const parseClientMetadata = (headers: Headers): ClientMetadata => {
  const userAgent = headers.get('user-agent') || '';

  const mobileMatch = userAgent.match(MOBILE_USER_AGENT_PATTERN);
  if (mobileMatch) {
    return {
      platform: mobileMatch[1].toLowerCase() as MobileClientPlatform,
      type: 'mobile',
      version: normalizeVersion(mobileMatch[2]),
    };
  }

  const desktopMatch = userAgent.match(DESKTOP_USER_AGENT_PATTERN);
  if (desktopMatch) {
    return {
      type: 'desktop',
      version: normalizeVersion(desktopMatch[1]),
    };
  }

  for (const pattern of LEGACY_IOS_USER_AGENT_PATTERNS) {
    const legacyIosMatch = userAgent.match(pattern);
    if (legacyIosMatch) {
      return {
        platform: 'ios',
        type: 'mobile',
        version: normalizeVersion(legacyIosMatch[1]),
      };
    }
  }

  if (/\bokhttp\//i.test(userAgent)) {
    return { platform: 'android', type: 'mobile' };
  }

  const webVersion = normalizeVersion(headers.get(CLIENT_VERSION_HEADER));
  if (webVersion) return { type: 'web', version: webVersion };

  return { type: 'unknown' };
};

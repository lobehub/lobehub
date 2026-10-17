import { gzipSync } from 'node:zlib';

/**
 * Feishu / Lark "scan to create an app": the OAuth 2.0 device authorization
 * flow behind the official SDK's `registerApp` (`@larksuiteoapi/node-sdk`).
 * The SDK runs begin + polling inside one promise; the bot channel UI needs
 * them as separate requests (begin returns the QR link, the client polls), so
 * this mirrors the SDK's wire protocol step by step.
 */

const REGISTRATION_ENDPOINT = '/oauth/v1/app/registration';

export const FEISHU_REGISTRATION_DOMAINS = {
  feishu: 'accounts.feishu.cn',
  lark: 'accounts.larksuite.com',
} as const;

export type FeishuRegistrationBrand = keyof typeof FEISHU_REGISTRATION_DOMAINS;

/**
 * What an agent bot needs on top of the platform's bot template: receive and
 * send messages, read chat history and files, and read docs shared into chats
 * (see the Feishu bot setup reference). Unknown names are ignored by the
 * confirm page, so this list only ever adds.
 */
export const AGENT_BOT_APP_ADDONS = {
  events: { items: { tenant: ['im.message.receive_v1'] } },
  scopes: {
    tenant: [
      'im:message',
      'im:message:send_as_bot',
      'im:message:readonly',
      'im:message.group_at_msg:readonly',
      'im:message.p2p_msg:readonly',
      'im:message.group_msg',
      'im:resource',
      'im:chat:readonly',
      'docx:document:readonly',
      'wiki:wiki:readonly',
    ],
  },
};

export interface FeishuAppPreset {
  /** Public image URL for the app avatar. */
  avatar?: string;
  desc?: string;
  /** App name; `{user}` is replaced with the scanning user's name. */
  name?: string;
}

export interface FeishuRegistrationBegin {
  deviceCode: string;
  /** Seconds until the QR link expires. */
  expiresIn: number;
  /** Seconds to wait between polls. */
  interval: number;
  /** Open in Feishu / Lark (or render as a QR code) to create the app. */
  url: string;
}

export type FeishuRegistrationPoll =
  | { brand: FeishuRegistrationBrand; status: 'pending'; slowDown?: boolean }
  | {
      appId: string;
      appSecret: string;
      brand: FeishuRegistrationBrand;
      openId?: string;
      status: 'success';
    }
  | { message?: string; status: 'denied' | 'expired' | 'error' };

/** The platform's encoding: JSON → gzip → base64url without padding. */
export const encodeAppAddons = (addons: object) =>
  gzipSync(Buffer.from(JSON.stringify(addons), 'utf8'))
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');

const requestRegistration = async (
  brand: FeishuRegistrationBrand,
  params: Record<string, string>,
): Promise<Record<string, any>> => {
  const res = await fetch(`https://${FEISHU_REGISTRATION_DOMAINS[brand]}${REGISTRATION_ENDPOINT}`, {
    body: new URLSearchParams(params).toString(),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    method: 'POST',
  });
  // RFC 8628: pending / slow_down / denied come back as HTTP 400 with a JSON body.
  const body = await res.json().catch(() => null);
  if (!body) throw new Error(`Feishu app registration failed (HTTP ${res.status})`);
  return body;
};

export const beginFeishuAppRegistration = async (
  preset: FeishuAppPreset = {},
): Promise<FeishuRegistrationBegin> => {
  // Always begins on Feishu, like the SDK; a Lark tenant is detected while polling.
  const res = await requestRegistration('feishu', {
    action: 'begin',
    archetype: 'PersonalAgent',
    auth_method: 'client_secret',
    request_user_info: 'open_id',
  });
  if (!res.device_code || !res.verification_uri_complete)
    throw new Error(res.error_description || res.error || 'Feishu app registration failed');

  const url = new URL(res.verification_uri_complete);
  url.searchParams.set('from', 'sdk');
  url.searchParams.set('tp', 'sdk');
  url.searchParams.set('source', 'node-sdk/lobehub');
  // Only offer creating a new app: binding an existing one could overwrite its config.
  url.searchParams.set('createOnly', 'true');
  if (preset.name) url.searchParams.set('name', preset.name);
  if (preset.desc) url.searchParams.set('desc', preset.desc);
  if (preset.avatar) url.searchParams.set('avatar', preset.avatar);
  url.searchParams.set('addons', encodeAppAddons(AGENT_BOT_APP_ADDONS));

  return {
    deviceCode: res.device_code,
    expiresIn: res.expires_in ?? 600,
    interval: res.interval ?? 5,
    url: url.toString(),
  };
};

export const pollFeishuAppRegistration = async (
  deviceCode: string,
  brand: FeishuRegistrationBrand = 'feishu',
): Promise<FeishuRegistrationPoll> => {
  const res = await requestRegistration(brand, { action: 'poll', device_code: deviceCode });

  // A Lark tenant answers on the Lark domain from here on (once).
  if (res.user_info?.tenant_brand === 'lark' && brand === 'feishu' && !res.client_id)
    return pollFeishuAppRegistration(deviceCode, 'lark');

  if (res.client_id && res.client_secret)
    return {
      appId: res.client_id,
      appSecret: res.client_secret,
      brand: res.user_info?.tenant_brand === 'lark' ? 'lark' : brand,
      openId: res.user_info?.open_id,
      status: 'success',
    };

  switch (res.error) {
    case 'authorization_pending': {
      return { brand, status: 'pending' };
    }
    case 'slow_down': {
      return { brand, slowDown: true, status: 'pending' };
    }
    case 'access_denied': {
      return { message: res.error_description, status: 'denied' };
    }
    case 'expired_token': {
      return { message: res.error_description, status: 'expired' };
    }
    default: {
      return { message: res.error_description || res.error, status: 'error' };
    }
  }
};

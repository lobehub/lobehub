import type { ComponentType } from 'react';

import { FeishuUserIdExtras } from '@/features/AgentSetting/AgentChannel/feishu/UserIdExtras';

import ImessageCredentialExtras from './imessage/CredentialExtras';
import LineCredentialExtras from './line/CredentialExtras';
import type {
  PlatformCredentialBodyProps,
  PlatformCredentialExtrasProps,
  PlatformSettingsFieldExtrasProps,
} from './types';
import WechatCredentialBody from './wechat/CredentialBody';

export const platformCredentialBodyMap: Record<
  string,
  ComponentType<PlatformCredentialBodyProps>
> = {
  wechat: WechatCredentialBody,
};

/**
 * Components rendered after the default credential block (i.e. when no
 * `platformCredentialBodyMap` override is in effect). Use this for small
 * platform-specific helpers like LINE's "fetch destination user ID from
 * /v2/bot/info" button — anything that augments the auto-generated form
 * without replacing it wholesale.
 */
export const platformCredentialExtrasMap: Record<
  string,
  ComponentType<PlatformCredentialExtrasProps>
> = {
  imessage: ImessageCredentialExtras,
  line: LineCredentialExtras,
};

/**
 * Components rendered directly under a single Advanced-Settings field, keyed
 * by `<platformId>:<fieldKey>`. Use this when a helper acts on one specific
 * setting rather than on the credential block — Feishu's "fetch my Open ID
 * from the app info" button has to sit next to `settings.userId`, which
 * `platformCredentialExtrasMap` renders too far from.
 *
 * Feishu and Lark share one schema but address different API domains, so both
 * ids are registered against the same component.
 */
export const platformSettingsFieldExtrasMap: Record<
  string,
  ComponentType<PlatformSettingsFieldExtrasProps>
> = {
  'feishu:userId': FeishuUserIdExtras,
  'lark:userId': FeishuUserIdExtras,
};

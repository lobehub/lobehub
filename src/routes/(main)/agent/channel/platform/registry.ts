import type { ComponentType } from 'react';

import LineCredentialExtras from './line/CredentialExtras';
import type { PlatformCredentialBodyProps } from './types';
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
export const platformCredentialExtrasMap: Record<string, ComponentType> = {
  line: LineCredentialExtras,
};

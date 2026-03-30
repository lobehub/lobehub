import type { ComponentType } from 'react';

import type { PlatformCredentialBodyProps } from './types';
import WechatCredentialBody from './wechat/CredentialBody';

export const platformCredentialBodyMap: Record<
  string,
  ComponentType<PlatformCredentialBodyProps>
> = {
  wechat: WechatCredentialBody,
};

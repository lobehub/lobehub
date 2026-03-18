import type { PlatformDefinition } from '../../types';
import { sharedClientFactory, sharedCredentials, sharedSettings } from './shared';

export const feishu: PlatformDefinition = {
  id: 'feishu',
  name: 'Feishu',
  description: 'Connect a Feishu bot',
  documentation: {
    portalUrl: 'https://open.feishu.cn/app',
    setupGuideUrl: 'https://lobehub.com/docs/usage/channels/feishu',
  },
  credentials: sharedCredentials,
  settings: sharedSettings,
  clientFactory: sharedClientFactory,
};

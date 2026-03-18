import type { PlatformDefinition } from '../../types';
import { sharedClientFactory, sharedCredentials, sharedSettings } from './shared';

export const lark: PlatformDefinition = {
  id: 'lark',
  name: 'Lark',
  description: 'Connect a Lark bot',
  documentation: {
    portalUrl: 'https://open.larksuite.com/app',
    setupGuideUrl: 'https://lobehub.com/docs/usage/channels/lark',
  },
  credentials: sharedCredentials,
  settings: sharedSettings,
  clientFactory: sharedClientFactory,
};

import type { ModelProviderCard } from '../types';

/**
 * SuperGrok / X Premium subscription access to Grok models via xAI OAuth
 * device flow (RFC 8628). Requests hit the same OpenAI-compatible
 * `https://api.x.ai/v1` endpoint as the `xai` provider, but authenticate
 * with a rotating OAuth token pair instead of an API key.
 *
 * The client_id below is xAI's public Grok-CLI OAuth client — the same one
 * used by opencode, officially endorsed by xAI: https://x.ai/news/grok-opencode
 */
const SuperGrok: ModelProviderCard = {
  chatModels: [],
  checkModel: 'grok-4.5',
  description:
    'Access Grok models with your SuperGrok or X Premium subscription, no API key required.',
  disableBrowserRequest: true,
  id: 'supergrok',
  modelsUrl: 'https://docs.x.ai/docs/models',
  name: 'SuperGrok',
  settings: {
    authType: 'oauthDeviceFlow',
    // OAuth tokens are refreshed and persisted server-side; browser requests
    // would bypass the refresh pipeline, so they are hard-disabled.
    disableBrowserRequest: true,
    oauthDeviceFlow: {
      clientId: 'b1a00492-073a-47ea-816f-4c329264a828',
      defaultPollingInterval: 5,
      deviceCodeEndpoint: 'https://auth.x.ai/oauth2/device/code',
      refreshTokenGrant: true,
      scopes: ['openid', 'profile', 'email', 'offline_access', 'grok-cli:access', 'api:access'],
      tokenEndpoint: 'https://auth.x.ai/oauth2/token',
    },
    sdkType: 'openai',
    showApiKey: false,
    showChecker: true,
  },
  url: 'https://x.ai/grok',
};

export default SuperGrok;

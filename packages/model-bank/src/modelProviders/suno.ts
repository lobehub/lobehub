import type { ModelProviderCard } from '../types';

/**
 * Suno music generation through a Suno API gateway (bring your own key).
 *
 * Suno's own API (platform.suno.com) is invite-only, so requests go to a third-party gateway:
 * kie.ai by default, or sunoapi.org / a compatible self-hosted service through the proxy URL.
 * There is no chat model, so the connectivity check verifies the key against the gateway's
 * credit endpoint instead of sending a chat message.
 * @see https://docs.kie.ai/suno-api/generate-music
 * @see https://docs.sunoapi.org/suno-api/generate-music
 */
const Suno: ModelProviderCard = {
  apiKeyUrl: 'https://kie.ai/api-key',
  chatModels: [],
  description:
    'Suno generates full songs with vocals, lyrics and instrumentals from a text prompt. Requests go through a third-party Suno API gateway (kie.ai by default, or sunoapi.org) with your own gateway key.',
  enabled: false,
  id: 'suno',
  modelsUrl: 'https://docs.kie.ai/suno-api/generate-music',
  name: 'Suno',
  settings: {
    checkMode: 'credentials',
    disableBrowserRequest: true,
    proxyUrl: {
      placeholder: 'https://api.kie.ai',
    },
    showAddNewModel: false,
    showModelFetcher: false,
  },
  url: 'https://suno.com',
};

export default Suno;

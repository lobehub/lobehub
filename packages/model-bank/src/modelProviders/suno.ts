import type { ModelProviderCard } from '../types';

/**
 * Suno music generation through a Suno API gateway (bring your own key).
 *
 * Suno's own API (platform.suno.com) is invite-only, so requests go to a third-party gateway:
 * sunoapi.org by default, or a gateway compatible with its `/api/v1/generate` API through the
 * proxy URL. kie.ai's jobs API is a different protocol and is not supported yet.
 * There is no chat model, so the connectivity check verifies the key against the gateway's
 * credit endpoint instead of sending a chat message.
 * @see https://docs.sunoapi.org/suno-api/generate-music
 */
const Suno: ModelProviderCard = {
  apiKeyUrl: 'https://sunoapi.org/api-key',
  chatModels: [],
  description:
    'Suno generates full songs with vocals, lyrics and instrumentals from a text prompt. Requests go through a third-party Suno API gateway (sunoapi.org by default, or a compatible gateway) with your own gateway key.',
  enabled: false,
  id: 'suno',
  modelsUrl: 'https://docs.sunoapi.org/suno-api/generate-music',
  name: 'Suno',
  settings: {
    checkMode: 'credentials',
    disableBrowserRequest: true,
    proxyUrl: {
      placeholder: 'https://api.sunoapi.org',
    },
    showAddNewModel: false,
    showModelFetcher: false,
  },
  url: 'https://suno.com',
};

export default Suno;

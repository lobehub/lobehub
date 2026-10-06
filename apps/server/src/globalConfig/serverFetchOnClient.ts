import { isDesktop } from '@/const/version';

/**
 * The deployment's `fetchOnClient` default for providers it overrides, as the
 * server global config hands it to the client store. `undefined` leaves the
 * provider's own default in place.
 *
 * - Desktop builds request local providers from the main process, never the
 *   renderer.
 * - A deployment with `OLLAMA_PROXY_URL` proxies Ollama through the server.
 */
export const getServerFetchOnClientOverride = (provider: string): boolean | undefined => {
  switch (provider) {
    case 'lmstudio':
    case 'unsloth': {
      return isDesktop ? false : undefined;
    }
    case 'ollama': {
      return isDesktop ? false : !process.env.OLLAMA_PROXY_URL;
    }
    default: {
      return undefined;
    }
  }
};

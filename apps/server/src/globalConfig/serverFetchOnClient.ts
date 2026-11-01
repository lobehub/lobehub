import { isDesktop } from '@/const/version';

/**
 * The deployment's `fetchOnClient` default for providers it overrides, as the
 * server global config hands it to the client store. `undefined` leaves the
 * provider's own default in place.
 *
 * - Desktop builds request local providers from the main process, never the
 *   renderer.
 * - On the web, local providers run on this device (the relay sends them to the
 *   tab), so the settings switch must show them on rather than unset.
 * - A deployment with `OLLAMA_PROXY_URL` proxies Ollama through the server.
 * - magpie is a desktop app on the user's own machine, answering on
 *   `127.0.0.1:3425`, and a hosted LobeHub cannot reach that from its server, so
 *   the browser sends the requests. A deployment that reaches a magpie
 *   elsewhere sets `MAGPIE_PROXY_URL` and the server sends them instead, which
 *   is what a magpie in Docker or on another host needs: it refuses a preflight
 *   that carries no key, which is the only kind a browser sends.
 */
export const getServerFetchOnClientOverride = (provider: string): boolean | undefined => {
  switch (provider) {
    case 'lmstudio':
    case 'unsloth': {
      return !isDesktop;
    }
    case 'magpie': {
      return isDesktop ? false : !process.env.MAGPIE_PROXY_URL;
    }
    case 'ollama': {
      return isDesktop ? false : !process.env.OLLAMA_PROXY_URL;
    }
    default: {
      return undefined;
    }
  }
};

export const ACE_CATALOG_URL = 'https://platform.acedata.cloud/api/v1/models/catalog/';

export interface AceCatalogModel {
  capabilities: string[];
  endpoints: { auth: string; base_url: string; path: string; protocol: string }[];
  id: string;
  modality: string;
  name?: string;
}

const cache = new WeakMap<typeof fetch, { expires: number; pending: Promise<AceCatalogModel[]> }>();

export const isOfficialAceEndpoint = (baseURL: string) => {
  const url = new URL(baseURL);
  return url.origin === 'https://api.acedata.cloud' && ['/v1', '/v1/'].includes(url.pathname);
};

export const loadAceCatalog = async (fetcher = fetch): Promise<AceCatalogModel[]> => {
  const existing = cache.get(fetcher);
  if (existing && existing.expires > Date.now()) return existing.pending;
  const pending = (async () => {
    // Public metadata is fetched without the customer's key or custom headers.
    const response = await fetcher(ACE_CATALOG_URL, {
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error('Unable to load the Ace Data Cloud model catalog');
    const body = await response.json();
    if (!Array.isArray(body.items) || !body.items.length) {
      throw new Error('Invalid Ace Data Cloud model catalog');
    }
    return body.items.filter(
      (item: AceCatalogModel) => item && typeof item.id === 'string' && item.modality === 'chat',
    ) as AceCatalogModel[];
  })();
  cache.set(fetcher, { expires: Date.now() + 5 * 60_000, pending });
  try {
    return await pending;
  } catch (error) {
    cache.delete(fetcher);
    throw error;
  }
};

export const aceChatProtocol = (model: AceCatalogModel) => {
  const endpoints = Array.isArray(model.endpoints) ? model.endpoints : [];
  for (const [protocol, path] of [
    ['chat_completions', '/v1/chat/completions'],
    ['messages', '/v1/messages'],
    ['responses', '/v1/responses'],
  ]) {
    if (
      endpoints.some(
        (endpoint) =>
          endpoint &&
          endpoint.protocol === protocol &&
          endpoint.path === path &&
          endpoint.auth === 'bearer' &&
          endpoint.base_url ===
            (protocol === 'messages'
              ? 'https://api.acedata.cloud'
              : 'https://api.acedata.cloud/v1'),
      )
    ) {
      return protocol;
    }
  }
  throw new Error(`No published chat protocol for Ace Data Cloud model ${model.id}`);
};

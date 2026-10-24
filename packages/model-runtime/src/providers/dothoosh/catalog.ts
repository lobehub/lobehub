import { createHash } from 'node:crypto';

import type { Pricing } from 'model-bank';

import type { DotHooshCatalog, DotHooshModelCard } from './parseModels';
import { buildPricing } from './parseModels';

// The Iran-hosted API is not reachable from outside Iran. Without a key the public catalog is
// read from this mirror, which relays the same bytes.
const MIRROR_BASE_URL = 'https://www.dothoosh.com/gateway';
export const DOTHOOSH_BASE_URL = 'https://gateway.dothoosh.com/v1';
const TRAILING_V1_PATTERN = /\/v1\/?$/;
const CATALOG_TTL_MS = 5 * 60 * 1000;
export const DOTHOOSH_CATALOG_ENTRY_LIMIT = 100;
const DOTHOOSH_PRICED_MODEL_LIMIT = 1000;

// Map insertion order is the recency order: a write moves the key to the newest position.
const rememberBounded = <K, V>(
  map: Map<K, V>,
  key: K,
  value: V,
  limit = DOTHOOSH_CATALOG_ENTRY_LIMIT,
) => {
  map.delete(key);
  map.set(key, value);
  while (map.size > limit) {
    const oldest = map.keys().next().value as K;
    map.delete(oldest);
  }
};

/**
 * Derive the Anthropic-compatible base URL from the configured OpenAI-compatible one, so a
 * custom proxy keeps working for both: `<origin>/v1` -> `<origin>/anthropic`.
 */
export const resolveAnthropicBaseURL = (baseURL: string) =>
  `${baseURL.replace(TRAILING_V1_PATTERN, '').replace(/\/$/, '')}/anthropic`;

interface CatalogOptions {
  apiKey?: string;
  baseURL?: string;
}

/** Keyless reads of the default endpoint go to the mirror; keyed reads go to the user's URL. */
export const resolveCatalogUrls = ({ apiKey, baseURL }: CatalogOptions) => {
  if (!apiKey && !baseURL) {
    return {
      anthropic: `${MIRROR_BASE_URL}/anthropic/v1/models`,
      openai: `${MIRROR_BASE_URL}/v1/models`,
    };
  }
  const base = baseURL || DOTHOOSH_BASE_URL;
  return {
    anthropic: `${resolveAnthropicBaseURL(base)}/v1/models`,
    openai: `${base.replace(/\/$/, '')}/models`,
  };
};

/**
 * Entries of a `{ data: [...] }` listing that carry an id; undefined when the body is not a listing
 * at all (an error envelope, HTML, null, `data` that is not a list).
 */
const listedEntries = (body: unknown): DotHooshModelCard[] | undefined => {
  const data = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return undefined;
  return data.filter(
    (item): item is DotHooshModelCard =>
      typeof (item as { id?: unknown } | null)?.id === 'string' &&
      (item as { id: string }).id.trim() !== '',
  );
};

const FETCH_TIMEOUT_MS = 10_000;

const fetchList = async (url: string, headers: Record<string, string>) => {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`DotHoosh models request to ${url} failed with status ${response.status}`);
  }
  const body = await response.json();
  const entries = listedEntries(body);
  if (!entries) throw new Error(`DotHoosh models response from ${url} is not a model listing`);
  // A well-formed empty list is a real answer; a list that has rows but none usable is not.
  if (entries.length === 0 && (body as { data: unknown[] }).data.length > 0) {
    throw new Error(`DotHoosh models response from ${url} has no usable model entries`);
  }
  return entries;
};

// The last good listing per endpoint. A listing that fails or is malformed must never shrink the
// catalog, so it is replaced by the previous good one, each listing on its own. A key with a model
// allow-list sees a filtered catalog, so keyed listings are remembered per key.
const lastGood = new Map<string, Partial<DotHooshCatalog>>();
const keyDigest = (apiKey?: string) =>
  apiKey ? createHash('sha256').update(apiKey).digest('hex') : '';
const lastGoodKey = ({ apiKey, baseURL }: CatalogOptions) =>
  `${(baseURL || DOTHOOSH_BASE_URL).replace(/\/$/, '')}|${keyDigest(apiKey)}`;
const publicKey = (options: CatalogOptions) => lastGoodKey({ baseURL: options.baseURL });

/** The key's own last good listing, else the public one of the same endpoint, never another key's. */
const previousListing = (own: string, shared: string, name: keyof DotHooshCatalog) =>
  lastGood.get(own)?.[name] ?? lastGood.get(shared)?.[name];

interface Listing {
  /** a keyed listing that is well-formed and empty: the key's allow-list holds nothing on this route */
  acceptedEmpty?: boolean;
  /** true when the result is not the live answer (failure, previous copy or refusal) */
  degraded: boolean;
  entries: DotHooshModelCard[];
  /** true when the request failed and no previous copy exists, so the route is unknown */
  unresolved?: boolean;
}

const withFallback = async (
  key: string,
  shared: string,
  name: keyof DotHooshCatalog,
  load: () => Promise<DotHooshModelCard[]>,
  options: { keyed: boolean; required: boolean },
): Promise<Listing> => {
  const previous = previousListing(key, shared, name);
  try {
    const entries = await load();
    if (entries.length > 0) {
      rememberBounded(lastGood, key, { ...lastGood.get(key), [name]: entries });
      return { degraded: false, entries };
    }
    // The gateway filters both listings by the key's model allow-list, so a keyed empty route is
    // legitimate. The public listing is never empty, so there an empty route is an outage.
    if (options.keyed) return { acceptedEmpty: true, degraded: false, entries };
    if (previous) {
      console.warn(`[DotHoosh] The ${name} listing is empty, keeping the previous model list`);
      return { degraded: true, entries: previous };
    }
    return { degraded: true, entries };
  } catch (error) {
    if (previous) {
      console.warn(`[DotHoosh] Keeping the previous ${name} model list:`, error);
      return { degraded: true, entries: previous };
    }
    if (options.required) throw error;
    console.warn(`[DotHoosh] Failed to fetch the ${name} model list:`, error);
    return { degraded: true, entries: [], unresolved: true };
  }
};

// The live price of every model DotHoosh's own endpoints list, by model id. Prices do not depend on
// the key (a key's allow-list only filters which models it sees); null = listed without a price.
const livePricing = new Map<string, Pricing | null>();

const rememberPricing = (entries: DotHooshModelCard[]) => {
  for (const card of entries) {
    rememberBounded(
      livePricing,
      card.id,
      (buildPricing(card) as Pricing | undefined) ?? null,
      DOTHOOSH_PRICED_MODEL_LIMIT,
    );
  }
};

// No base URL means the default endpoint (keyed) or the public mirror (keyless); an explicit one
// equal to the default is the same endpoint.
const isTrustedPriceSource = (baseURL?: string) =>
  !baseURL || baseURL.replace(/\/+$/, '') === DOTHOOSH_BASE_URL;

/** The price DotHoosh's own catalog currently lists for `model`; undefined when it lists none. */
export const getDotHooshLivePricing = (model: string): Pricing | undefined =>
  livePricing.get(model) ?? undefined;

const forget = (key: string, name: keyof DotHooshCatalog) => {
  if (!lastGood.has(key)) return;
  const { [name]: _forgotten, ...rest } = lastGood.get(key) ?? {};
  rememberBounded(lastGood, key, rest);
};

interface CatalogResult {
  catalog: DotHooshCatalog;
  /** true when a listing could not be read live and was replaced or left empty */
  degraded: boolean;
  /** the listings whose request failed with no previous copy: their routes are unknown */
  unresolved: Array<keyof DotHooshCatalog>;
}

const unresolvedOf = (openai: Listing, anthropic: Listing): Array<keyof DotHooshCatalog> => [
  ...(openai.unresolved ? (['openai'] as const) : []),
  ...(anthropic.unresolved ? (['anthropic'] as const) : []),
];

/**
 * `listing` is the model picker: a keyed empty route is the key's allow-list and is accepted. For
 * routing (`listing` false) an empty route keeps the previous ids instead, since where a model is
 * sent never depends on whether this key may call it.
 */
const fetchCatalog = async (options: CatalogOptions, listing: boolean): Promise<CatalogResult> => {
  const urls = resolveCatalogUrls(options);
  const { apiKey } = options;
  const key = lastGoodKey(options);
  const shared = publicKey(options);
  const keyed = listing && Boolean(apiKey);
  const [openai, anthropic] = await Promise.all([
    withFallback(
      key,
      shared,
      'openai',
      () => fetchList(urls.openai, apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      { keyed, required: true },
    ),
    withFallback(
      key,
      shared,
      'anthropic',
      () =>
        fetchList(urls.anthropic, {
          'anthropic-version': '2023-06-01',
          ...(apiKey ? { 'x-api-key': apiKey } : {}),
        }),
      { keyed, required: false },
    ),
  ]);

  // Prices come only from DotHoosh's own endpoints: a user-supplied base URL may route that user's
  // chats, never price anyone's. A model on both listings is priced by the OpenAI one, which routes it.
  if (isTrustedPriceSource(options.baseURL)) {
    const onOpenAIListing = new Set(openai.entries.map((card) => card.id));
    if (!anthropic.degraded) {
      rememberPricing(anthropic.entries.filter((card) => !onOpenAIListing.has(card.id)));
    }
    if (!openai.degraded) rememberPricing(openai.entries);
  }

  if (openai.entries.length === 0 && anthropic.entries.length === 0) {
    // Both routes empty: an outage, not an allow-list. Keep the last good catalog if there is one.
    const previous = {
      anthropic: previousListing(key, shared, 'anthropic') ?? [],
      openai: previousListing(key, shared, 'openai') ?? [],
    };
    if (previous.openai.length > 0 || previous.anthropic.length > 0) {
      console.warn('[DotHoosh] Both listings are empty, keeping the previous model list');
      return { catalog: previous, degraded: true, unresolved: unresolvedOf(openai, anthropic) };
    }
    throw new Error('DotHoosh returned no models and there is no previous list to keep');
  }
  // The key's allow-list now holds nothing on a route: do not resurrect its old models later.
  if (openai.acceptedEmpty) forget(key, 'openai');
  if (anthropic.acceptedEmpty) forget(key, 'anthropic');
  if (openai.entries.length === 0) {
    console.warn(
      '[DotHoosh] The OpenAI listing is empty; only Anthropic-route models are available',
    );
  }

  return {
    catalog: { anthropic: anthropic.entries, openai: openai.entries },
    degraded: openai.degraded || anthropic.degraded,
    unresolved: unresolvedOf(openai, anthropic),
  };
};

/** Both listings; the OpenAI one is required, the Claude one degrades to empty. */
export const fetchDotHooshCatalog = async (options: CatalogOptions): Promise<DotHooshCatalog> =>
  (await fetchCatalog(options, true)).catalog;

const DEGRADED_TTL_MS = 10 * 1000;

interface CacheEntry {
  at: number;
  result: Promise<CatalogResult>;
  ttl: number;
}
const cache = new Map<string, CacheEntry>();

const dropExpired = (now: number) => {
  for (const [key, entry] of cache) if (now - entry.at >= entry.ttl) cache.delete(key);
};

/**
 * Per-endpoint-and-key cache so routing a chat does not refetch the catalog every time. A catalog
 * with a listing that could not be read live is only kept briefly, so a recovered listing is
 * picked up on the next chats instead of after the full TTL.
 */
export const getDotHooshRoutingCatalog = (options: CatalogOptions): Promise<CatalogResult> => {
  const key = createHash('sha256')
    .update(`${options.baseURL ?? ''}|${options.apiKey ?? ''}`)
    .digest('hex');
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) {
    cache.delete(key);
    cache.set(key, hit);
    return hit.result;
  }

  dropExpired(Date.now());
  const pending = fetchCatalog(options, false);
  const entry: CacheEntry = { at: Date.now(), result: pending, ttl: CATALOG_TTL_MS };
  rememberBounded(cache, key, entry);
  pending.then(
    (result) => {
      entry.at = Date.now();
      entry.ttl = result.degraded ? DEGRADED_TTL_MS : CATALOG_TTL_MS;
    },
    () => {
      if (cache.get(key) === entry) cache.delete(key);
    },
  );
  return pending;
};

/**
 * Per-endpoint-and-key cache of the catalog; see `getDotHooshRoutingCatalog` for the cache rules.
 */
export const getDotHooshCatalog = (options: CatalogOptions): Promise<DotHooshCatalog> =>
  getDotHooshRoutingCatalog(options).then((result) => result.catalog);

export const clearDotHooshCatalogCache = () => {
  cache.clear();
  lastGood.clear();
  livePricing.clear();
};

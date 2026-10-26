import debug from 'debug';

import type { FalJsonSchema } from './schema';
import {
  extractFalInputSchema,
  falInputSchemaToImageParameters,
  falInputSchemaToVideoParameters,
} from './schema';

const log = debug('lobe-image:fal:catalog');

// https://fal.ai/docs/platform-apis/v1/models
const FAL_MODELS_API = 'https://api.fal.ai/v1/models';

/**
 * Catalog categories the generation pages can drive, in listing order, with the model type each
 * maps to.
 */
const FAL_GENERATION_CATEGORIES = [
  ['text-to-image', 'image'],
  ['image-to-image', 'image'],
  ['text-to-video', 'video'],
  ['image-to-video', 'video'],
] as const;

type FalGenerationCategory = (typeof FAL_GENERATION_CATEGORIES)[number];

/** fal caps the page size at 10 when a catalog request expands OpenAPI schemas */
export const FAL_CATALOG_PAGE_SIZE = 10;

/** Upper bound of pages per category, so a model fetch stays a bounded number of requests */
const MAX_PAGES_PER_CATEGORY = 40;

/** Attempts per catalog request; fal rate limits (429) bursts of paginated requests */
const MAX_ATTEMPTS = 4;
const MAX_RETRY_DELAY_MS = 8000;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Delay before retrying a 429: fal's `Retry-After` seconds when sent, else exponential backoff */
const retryDelay = (response: Response, attempt: number) => {
  const retryAfter = Number(response.headers.get('retry-after'));
  const delay = Number.isFinite(retryAfter) && response.headers.has('retry-after')
    ? retryAfter * 1000
    : 1000 * 2 ** attempt;
  return Math.min(Math.max(delay, 0), MAX_RETRY_DELAY_MS);
};

interface FalCatalogModel {
  endpoint_id: string;
  metadata?: {
    category?: string;
    date?: string;
    description?: string;
    display_name?: string;
    kind?: string;
    status?: string;
  };
  openapi?: unknown;
}

interface FalCatalogPage {
  has_more?: boolean;
  models?: FalCatalogModel[];
  next_cursor?: string | null;
}

export interface FalModelListItem {
  description?: string;
  displayName: string;
  id: string;
  parameters: Record<string, unknown>;
  releasedAt?: string;
  type: 'image' | 'video';
}

const requestCatalog = async (
  apiKey: string,
  query: Record<string, string | undefined>,
  signal?: AbortSignal,
): Promise<FalCatalogPage> => {
  const url = new URL(FAL_MODELS_API);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(key, value);
  }

  let response = await fetch(url, { headers: { Authorization: `Key ${apiKey}` }, signal });
  for (let attempt = 1; response.status === 429 && attempt < MAX_ATTEMPTS; attempt++) {
    await wait(retryDelay(response, attempt - 1));
    response = await fetch(url, { headers: { Authorization: `Key ${apiKey}` }, signal });
  }

  if (!response.ok) {
    const error = new Error(`fal model catalog request failed: ${response.status}`);
    Object.assign(error, { status: response.status });
    throw error;
  }

  return response.json();
};

const toModelListItem = (
  model: FalCatalogModel,
  type: 'image' | 'video',
): FalModelListItem | undefined => {
  if (model.metadata?.kind === 'training') return;

  const input = extractFalInputSchema(model.openapi, model.endpoint_id);
  const parameters =
    type === 'image'
      ? falInputSchemaToImageParameters(input)
      : falInputSchemaToVideoParameters(input);
  if (!parameters) return;

  const releasedAt = model.metadata?.date?.slice(0, 10);

  return {
    description: model.metadata?.description?.trim(),
    displayName: model.metadata?.display_name || model.endpoint_id,
    id: model.endpoint_id,
    parameters,
    ...(releasedAt && { releasedAt }),
    type,
  };
};

const listCategory = async (
  apiKey: string,
  [category, type]: FalGenerationCategory,
  signal?: AbortSignal,
) => {
  const items: FalModelListItem[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < MAX_PAGES_PER_CATEGORY; page++) {
    let result: FalCatalogPage;
    try {
      result = await requestCatalog(
        apiKey,
        {
          category,
          cursor,
          expand: 'openapi-3.0',
          limit: String(FAL_CATALOG_PAGE_SIZE),
          status: 'active',
        },
        signal,
      );
    } catch (error) {
      // Keep the pages already listed; only a category whose first page fails is lost
      if (page === 0) throw error;
      log('fal catalog %s stopped at page %d: %O', category, page, error);
      break;
    }

    for (const model of result.models ?? []) {
      const item = toModelListItem(model, type);
      if (item) items.push(item);
    }

    if (!result.has_more || !result.next_cursor) break;
    cursor = result.next_cursor;
  }

  return items;
};

/**
 * List the fal endpoints that can run on the image and video generation pages, each with the
 * parameters derived from its input schema. Categories are listed one after another to stay
 * under fal's rate limit. A failing category is skipped so it does not hide the rest; only a
 * failure of every category (e.g. an invalid key) is thrown.
 */
export const listFalGenerationModels = async (apiKey: string, signal?: AbortSignal) => {
  const results: PromiseSettledResult<FalModelListItem[]>[] = [];
  for (const category of FAL_GENERATION_CATEGORIES) {
    try {
      results.push({ status: 'fulfilled', value: await listCategory(apiKey, category, signal) });
    } catch (reason) {
      results.push({ reason, status: 'rejected' });
    }
  }

  const rejected = results.filter((result) => result.status === 'rejected');
  if (rejected.length === results.length) throw (rejected[0] as PromiseRejectedResult).reason;

  const models = new Map<string, FalModelListItem>();
  for (const result of results) {
    if (result.status === 'rejected') {
      log('fal catalog category failed: %O', result.reason);
      continue;
    }
    for (const item of result.value) if (!models.has(item.id)) models.set(item.id, item);
  }

  return [...models.values()];
};

/** fal redeploys endpoints in place, so a cached input schema is refetched after this long */
export const FAL_INPUT_SCHEMA_TTL_MS = 60 * 60 * 1000;

const inputSchemaCache = new Map<
  string,
  { expiresAt: number; schema: Promise<FalJsonSchema | undefined> }
>();

/**
 * Input schema of one fal endpoint, cached per process for `FAL_INPUT_SCHEMA_TTL_MS`. Resolves
 * undefined when the catalog cannot be reached, so callers fall back to sending the request as
 * built.
 */
export const getFalInputSchema = (apiKey: string, endpointId: string) => {
  const cached = inputSchemaCache.get(endpointId);
  if (cached && cached.expiresAt > Date.now()) return cached.schema;

  const schema = requestCatalog(apiKey, { endpoint_id: endpointId, expand: 'openapi-3.0' })
    .then((page) => {
      const model = page.models?.find((item) => item.endpoint_id === endpointId);
      return extractFalInputSchema(model?.openapi, endpointId);
    })
    .catch((error) => {
      log('Failed to load fal input schema for %s: %O', endpointId, error);
      inputSchemaCache.delete(endpointId);
      return undefined;
    });

  inputSchemaCache.set(endpointId, { expiresAt: Date.now() + FAL_INPUT_SCHEMA_TTL_MS, schema });
  return schema;
};

/** @internal Test helper */
export const clearFalInputSchemaCache = () => inputSchemaCache.clear();

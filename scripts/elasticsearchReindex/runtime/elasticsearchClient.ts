import { isDeepStrictEqual } from 'node:util';

import { z } from 'zod';

import { parseElasticsearchUrl } from '../../../packages/database/src/repositories/ftsSearch/elasticsearch/url';
import type {
  FtsSearchReindexBulkItemResult,
  FtsSearchReindexElasticsearchClient,
  FtsSearchReindexIndexBody,
  FtsSearchReindexIndexOptions,
} from './reindexService';

const bulkResponseSchema = z.object({
  items: z.array(
    z.object({
      index: z.object({ error: z.unknown().optional(), status: z.number() }),
    }),
  ),
});

const countResponseSchema = z.object({ count: z.number().int().nonnegative() });

const aliasResponseSchema = z.record(
  z.string(),
  z.object({
    aliases: z.record(
      z.string(),
      z.object({ is_write_index: z.boolean().optional() }).passthrough(),
    ),
  }),
);

interface ElasticsearchFtsSearchMappingPropertyResponse {
  analyzer?: string;
  fields?: Record<string, ElasticsearchFtsSearchMappingPropertyResponse>;
  ignore_above?: number;
  type?: string;
}

const mappingPropertyResponseSchema: z.ZodType<ElasticsearchFtsSearchMappingPropertyResponse> =
  z.lazy(() =>
    z.object({
      analyzer: z.string().optional(),
      fields: z.record(z.string(), mappingPropertyResponseSchema).optional(),
      ignore_above: z.number().int().positive().optional(),
      type: z.string().optional(),
    }),
  );

const mappingResponseSchema = z.record(
  z.string(),
  z.object({
    mappings: z.object({
      _meta: z
        .object({
          reindex_run_id: z.string().optional(),
          schema_version: z.number().int().positive().optional(),
        })
        .optional(),
      dynamic: z.union([z.boolean(), z.string()]).optional(),
      properties: z.record(z.string(), mappingPropertyResponseSchema),
    }),
  }),
);

const settingsResponseSchema = z.record(
  z.string(),
  z.object({
    settings: z.object({
      index: z.object({ analysis: z.record(z.string(), z.unknown()) }),
    }),
  }),
);

export interface FtsSearchReindexHttpClientOptions {
  apiKey: string;
  requestTimeoutMs?: number;
  url: string;
}

export class FtsSearchReindexRequestError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number, cause?: unknown) {
    super(message, { cause });
    this.name = 'FtsSearchReindexRequestError';
    this.status = status;
  }
}

/** Minimal credential-safe Elasticsearch transport for the self-host reindex command. */
export class FtsSearchReindexHttpClient implements FtsSearchReindexElasticsearchClient {
  private readonly apiKey: string;
  private readonly requestTimeoutMs: number;
  private readonly url: URL;

  constructor({ apiKey, requestTimeoutMs = 30_000, url }: FtsSearchReindexHttpClientOptions) {
    this.apiKey = apiKey;
    this.requestTimeoutMs = requestTimeoutMs;
    this.url = parseElasticsearchUrl(url);
  }

  private async request(path: string, init: RequestInit = {}) {
    return fetch(new URL(path, this.url), {
      ...init,
      headers: {
        Authorization: `ApiKey ${this.apiKey}`,
        ...init.headers,
      },
      signal: AbortSignal.timeout(this.requestTimeoutMs),
    });
  }

  private assertMappingProperty(
    field: string,
    actual: ElasticsearchFtsSearchMappingPropertyResponse | undefined,
    expected: ElasticsearchFtsSearchMappingPropertyResponse,
  ) {
    if (
      !actual ||
      actual.type !== expected.type ||
      actual.analyzer !== expected.analyzer ||
      actual.ignore_above !== expected.ignore_above
    ) {
      throw new FtsSearchReindexRequestError(
        `Elasticsearch index mapping is incompatible for ${field}`,
      );
    }
    for (const [subfield, expectedSubfield] of Object.entries(expected.fields ?? {})) {
      this.assertMappingProperty(
        `${field}.${subfield}`,
        actual.fields?.[subfield],
        expectedSubfield,
      );
    }
  }

  private async assertIndexMapping(index: string, expected: FtsSearchReindexIndexBody) {
    const response = await this.request(`/${encodeURIComponent(index)}/_mapping`, {
      method: 'GET',
    });
    if (!response.ok) {
      throw new FtsSearchReindexRequestError(
        `Elasticsearch mapping check failed for ${index} (${response.status})`,
        response.status,
      );
    }
    const parsed = mappingResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new FtsSearchReindexRequestError(
        `Elasticsearch mapping response has an invalid shape for ${index}`,
        response.status,
        parsed.error,
      );
    }
    const actual = parsed.data[index]?.mappings;
    if (
      !actual ||
      actual.dynamic !== expected.mappings.dynamic ||
      actual._meta?.reindex_run_id !== expected.mappings._meta.reindex_run_id ||
      actual._meta?.schema_version !== expected.mappings._meta.schema_version
    ) {
      throw new FtsSearchReindexRequestError(
        `Elasticsearch index mapping or reindex run identity is incompatible for ${index}; restore the matching checkpoint or use a clean target`,
      );
    }
    for (const [field, expectedProperty] of Object.entries(expected.mappings.properties)) {
      this.assertMappingProperty(field, actual.properties[field], expectedProperty);
    }
  }

  private async assertIndexAnalysis(index: string, expected: FtsSearchReindexIndexBody) {
    const response = await this.request(
      `/${encodeURIComponent(index)}/_settings?flat_settings=false&filter_path=*.settings.index.analysis`,
      { method: 'GET' },
    );
    if (!response.ok) {
      throw new FtsSearchReindexRequestError(
        `Elasticsearch analysis settings check failed for ${index} (${response.status})`,
        response.status,
      );
    }
    const parsed = settingsResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new FtsSearchReindexRequestError(
        `Elasticsearch analysis settings response has an invalid shape for ${index}`,
        response.status,
        parsed.error,
      );
    }
    if (
      !isDeepStrictEqual(parsed.data[index]?.settings.index.analysis, expected.settings.analysis)
    ) {
      throw new FtsSearchReindexRequestError(
        `Elasticsearch analysis settings are incompatible for ${index}`,
      );
    }
  }

  async bulk(body: string): Promise<FtsSearchReindexBulkItemResult[]> {
    const response = await this.request('/_bulk', {
      body,
      headers: { 'Content-Type': 'application/x-ndjson' },
      method: 'POST',
    });
    if (!response.ok) {
      throw new FtsSearchReindexRequestError(
        `Elasticsearch bulk request failed (${response.status})`,
        response.status,
      );
    }

    const parsed = bulkResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new FtsSearchReindexRequestError(
        'Elasticsearch bulk response has an invalid shape',
        response.status,
        parsed.error,
      );
    }
    return parsed.data.items.map(({ index }) => index);
  }

  async count(index: string): Promise<number> {
    const response = await this.request(`/${encodeURIComponent(index)}/_count`, { method: 'GET' });
    if (!response.ok) {
      throw new FtsSearchReindexRequestError(
        `Elasticsearch count request failed for ${index} (${response.status})`,
        response.status,
      );
    }

    const parsed = countResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new FtsSearchReindexRequestError(
        `Elasticsearch count response has an invalid shape for ${index}`,
        response.status,
        parsed.error,
      );
    }
    return parsed.data.count;
  }

  async ensureAlias(alias: string, physicalIndex: string): Promise<void> {
    const response = await this.request(`/_alias/${encodeURIComponent(alias)}`, { method: 'GET' });
    if (response.ok) {
      const parsed = aliasResponseSchema.safeParse(await response.json());
      if (!parsed.success) {
        throw new FtsSearchReindexRequestError(
          `Elasticsearch alias response has an invalid shape for ${alias}`,
          response.status,
          parsed.error,
        );
      }
      const targets = Object.entries(parsed.data).filter(([, value]) =>
        Object.hasOwn(value.aliases, alias),
      );
      if (
        targets.length === 1 &&
        targets[0][0] === physicalIndex &&
        targets[0][1].aliases[alias].is_write_index !== false
      ) {
        return;
      }

      /**
       * Incremental sync writes only through the stable alias. Moving that alias while a resumable
       * backfill is running could acknowledge a change in the old index without replaying it into
       * the new one. Online schema upgrades therefore require a separate durable dual-write
       * protocol; this initial migration fails closed instead of pretending the cutover is safe.
       */
      throw new FtsSearchReindexRequestError(
        `Elasticsearch alias ${alias} already points to a different index`,
      );
    }
    if (response.status !== 404) {
      throw new FtsSearchReindexRequestError(
        `Elasticsearch alias check failed for ${alias} (${response.status})`,
        response.status,
      );
    }

    const createResponse = await this.request('/_aliases', {
      body: JSON.stringify({
        actions: [{ add: { alias, index: physicalIndex, is_write_index: true } }],
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    if (!createResponse.ok) {
      throw new FtsSearchReindexRequestError(
        `Elasticsearch alias creation failed for ${alias} (${createResponse.status})`,
        createResponse.status,
      );
    }
  }

  async ensureIndex(
    index: string,
    body: FtsSearchReindexIndexBody,
    { createIfMissing = true }: FtsSearchReindexIndexOptions = {},
  ): Promise<void> {
    const existsResponse = await this.request(`/${encodeURIComponent(index)}`, { method: 'HEAD' });
    if (existsResponse.ok) {
      await this.assertIndexMapping(index, body);
      await this.assertIndexAnalysis(index, body);
      return;
    }
    if (existsResponse.status !== 404) {
      throw new FtsSearchReindexRequestError(
        `Elasticsearch index check failed for ${index} (${existsResponse.status})`,
        existsResponse.status,
      );
    }
    if (!createIfMissing) {
      throw new FtsSearchReindexRequestError(
        `Completed Elasticsearch index ${index} is missing; use a new checkpoint and an empty target for a full backfill`,
        existsResponse.status,
      );
    }

    const response = await this.request(`/${encodeURIComponent(index)}`, {
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
      method: 'PUT',
    });
    if (!response.ok) {
      throw new FtsSearchReindexRequestError(
        `Elasticsearch index creation failed for ${index} (${response.status})`,
        response.status,
      );
    }
  }

  async refresh(index: string): Promise<void> {
    const response = await this.request(`/${encodeURIComponent(index)}/_refresh`, {
      method: 'POST',
    });
    if (!response.ok) {
      throw new FtsSearchReindexRequestError(
        `Elasticsearch refresh failed for ${index} (${response.status})`,
        response.status,
      );
    }
  }
}

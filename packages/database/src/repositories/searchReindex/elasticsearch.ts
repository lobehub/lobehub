import { z } from 'zod';

import type {
  SearchReindexBulkItemResult,
  SearchReindexElasticsearchClient,
  SearchReindexIndexBody,
} from './service';

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

interface ElasticsearchMappingPropertyResponse {
  analyzer?: string;
  fields?: Record<string, ElasticsearchMappingPropertyResponse>;
  ignore_above?: number;
  type?: string;
}

const mappingPropertyResponseSchema: z.ZodType<ElasticsearchMappingPropertyResponse> = z.lazy(() =>
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

export interface SearchReindexHttpClientOptions {
  apiKey: string;
  requestTimeoutMs?: number;
  url: string;
}

export class SearchReindexRequestError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number, cause?: unknown) {
    super(message, { cause });
    this.name = 'SearchReindexRequestError';
    this.status = status;
  }
}

/** Minimal credential-safe Elasticsearch transport for the self-host reindex command. */
export class SearchReindexHttpClient implements SearchReindexElasticsearchClient {
  private readonly apiKey: string;
  private readonly requestTimeoutMs: number;
  private readonly url: URL;

  constructor({ apiKey, requestTimeoutMs = 30_000, url }: SearchReindexHttpClientOptions) {
    this.apiKey = apiKey;
    this.requestTimeoutMs = requestTimeoutMs;
    this.url = new URL(url);
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
    actual: ElasticsearchMappingPropertyResponse | undefined,
    expected: ElasticsearchMappingPropertyResponse,
  ) {
    if (
      !actual ||
      actual.type !== expected.type ||
      actual.analyzer !== expected.analyzer ||
      actual.ignore_above !== expected.ignore_above
    ) {
      throw new SearchReindexRequestError(
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

  private async assertIndexMapping(index: string, expected: SearchReindexIndexBody) {
    const response = await this.request(`/${encodeURIComponent(index)}/_mapping`, {
      method: 'GET',
    });
    if (!response.ok) {
      throw new SearchReindexRequestError(
        `Elasticsearch mapping check failed for ${index} (${response.status})`,
        response.status,
      );
    }
    const parsed = mappingResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new SearchReindexRequestError(
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
      throw new SearchReindexRequestError(
        `Elasticsearch index mapping or reindex run identity is incompatible for ${index}; restore the matching checkpoint or use a clean target`,
      );
    }
    for (const [field, expectedProperty] of Object.entries(expected.mappings.properties)) {
      this.assertMappingProperty(field, actual.properties[field], expectedProperty);
    }
  }

  async bulk(body: string): Promise<SearchReindexBulkItemResult[]> {
    const response = await this.request('/_bulk', {
      body,
      headers: { 'Content-Type': 'application/x-ndjson' },
      method: 'POST',
    });
    if (!response.ok) {
      throw new SearchReindexRequestError(
        `Elasticsearch bulk request failed (${response.status})`,
        response.status,
      );
    }

    const parsed = bulkResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new SearchReindexRequestError(
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
      throw new SearchReindexRequestError(
        `Elasticsearch count request failed for ${index} (${response.status})`,
        response.status,
      );
    }

    const parsed = countResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new SearchReindexRequestError(
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
        throw new SearchReindexRequestError(
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
      throw new SearchReindexRequestError(
        `Elasticsearch alias ${alias} already points to a different index`,
      );
    }
    if (response.status !== 404) {
      throw new SearchReindexRequestError(
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
      throw new SearchReindexRequestError(
        `Elasticsearch alias creation failed for ${alias} (${createResponse.status})`,
        createResponse.status,
      );
    }
  }

  async ensureIndex(index: string, body: SearchReindexIndexBody): Promise<void> {
    const existsResponse = await this.request(`/${encodeURIComponent(index)}`, { method: 'HEAD' });
    if (existsResponse.ok) {
      await this.assertIndexMapping(index, body);
      return;
    }
    if (existsResponse.status !== 404) {
      throw new SearchReindexRequestError(
        `Elasticsearch index check failed for ${index} (${existsResponse.status})`,
        existsResponse.status,
      );
    }

    const response = await this.request(`/${encodeURIComponent(index)}`, {
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
      method: 'PUT',
    });
    if (!response.ok) {
      throw new SearchReindexRequestError(
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
      throw new SearchReindexRequestError(
        `Elasticsearch refresh failed for ${index} (${response.status})`,
        response.status,
      );
    }
  }
}

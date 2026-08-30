import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

import { z } from 'zod';

import type {
  ElasticsearchSearchClient,
  ElasticsearchSearchInput,
  ElasticsearchSearchResponse,
} from '@/database/repositories/search';
import { parseElasticsearchUrl } from '@/database/repositories/search/elasticsearch/url';

import type { ElasticsearchSearchRequestResult } from './observability';
import { recordElasticsearchSearchRequest } from './observability';

const searchResponseSchema = z.object({
  hits: z.object({
    hits: z.array(
      z.object({
        _id: z.string(),
        _score: z.number().nullable(),
        sort: z.array(z.unknown()).optional(),
      }),
    ),
    total: z.union([z.number(), z.object({ value: z.number() })]).optional(),
  }),
  took: z.number().nonnegative().optional(),
});

const bulkResponseSchema = z.object({
  errors: z.boolean().optional(),
  items: z.array(
    z.object({
      index: z.object({ error: z.unknown().optional(), status: z.number() }),
    }),
  ),
});

const aliasResponseSchema = z.record(
  z.string(),
  z.object({
    aliases: z.record(
      z.string(),
      z.object({ is_write_index: z.boolean().optional() }).passthrough(),
    ),
  }),
);

const fieldMappingResponseSchema = z.record(
  z.string(),
  z.object({
    mappings: z.record(
      z.string(),
      z.object({
        mapping: z.record(z.string(), z.object({ type: z.string() }).passthrough()),
      }),
    ),
  }),
);

const indexIdentityResponseSchema = z.record(
  z.string(),
  z.object({
    mappings: z
      .object({
        _meta: z
          .object({
            reindex_run_id: z.string().uuid(),
            schema_version: z.number().int().positive(),
          })
          .passthrough(),
        properties: z
          .object({
            search_sync_deleted: z.object({ type: z.literal('boolean') }).passthrough(),
          })
          .passthrough(),
      })
      .passthrough(),
    settings: z.object({
      index: z
        .object({
          analysis: z.record(z.string(), z.unknown()),
          uuid: z.string().trim().min(1),
        })
        .passthrough(),
    }),
  }),
);

const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;

  return `{${Object.entries(value)
    .sort(([leftKey], [rightKey]) => (leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(',')}}`;
};

const sha256Json = (value: unknown) =>
  createHash('sha256').update(stableStringify(value)).digest('hex');

export interface ElasticsearchBulkResponse {
  errors?: boolean;
  items: Array<{ index: { error?: unknown; status: number } }>;
}

export interface ElasticsearchHttpClientOptions {
  apiKey: string;
  requestTimeoutMs?: number;
  url: string;
}

export interface ElasticsearchSearchSyncIndexIdentity {
  indexUuid: string;
  mappingSha256: string;
  physicalIndex: string;
  reindexRunId: string;
  schemaVersion: number;
  settingsSha256: string;
}

export class ElasticsearchSearchRequestError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number, cause?: unknown) {
    super(message, { cause });
    this.name = 'ElasticsearchSearchRequestError';
    this.status = status;
  }
}

const classifyRequestError = (error: unknown): ElasticsearchSearchRequestResult =>
  error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')
    ? 'timeout'
    : 'other_error';

const readContentLength = (response: Response): number | undefined => {
  const header = response.headers.get('content-length');
  if (!header) return;
  const value = Number(header);
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
};

/** HTTP transport that never logs credentials, request text, or Elasticsearch payloads. */
export class ElasticsearchHttpClient implements ElasticsearchSearchClient {
  private readonly apiKey: string;
  private readonly requestTimeoutMs: number;
  private readonly url: URL;

  constructor({ apiKey, requestTimeoutMs = 10_000, url }: ElasticsearchHttpClientOptions) {
    this.apiKey = apiKey;
    this.requestTimeoutMs = requestTimeoutMs;
    this.url = parseElasticsearchUrl(url);
  }

  /** Fails closed unless every incremental destination is a writable alias with tombstone support. */
  async assertSearchSyncAliases(aliases: string[]): Promise<void> {
    await this.getSearchSyncWriteTargets(aliases);
  }

  private async getSearchSyncWriteTargetMap(aliases: string[]) {
    const aliasPath = aliases.map(encodeURIComponent).join(',');
    const aliasResponse = await fetch(new URL(`/_alias/${aliasPath}`, this.url), {
      headers: { Authorization: `ApiKey ${this.apiKey}` },
      method: 'GET',
      signal: AbortSignal.timeout(this.requestTimeoutMs),
    });
    if (!aliasResponse.ok) {
      throw new ElasticsearchSearchRequestError(
        `Elasticsearch search sync alias check failed (${aliasResponse.status})`,
        aliasResponse.status,
      );
    }

    let aliasJson: unknown;
    try {
      aliasJson = await aliasResponse.json();
    } catch {
      throw new ElasticsearchSearchRequestError(
        'Elasticsearch search sync alias response is not valid JSON',
        aliasResponse.status,
      );
    }
    const aliasPayload = aliasResponseSchema.safeParse(aliasJson);
    if (!aliasPayload.success) {
      throw new ElasticsearchSearchRequestError(
        'Elasticsearch search sync alias response has an invalid shape',
        aliasResponse.status,
      );
    }

    const writeTargets = new Map<string, string>();
    for (const alias of aliases) {
      const targets = Object.entries(aliasPayload.data).filter(([, value]) =>
        Object.hasOwn(value.aliases, alias),
      );
      const explicitWriteTargets = targets.filter(
        ([, value]) => value.aliases[alias].is_write_index === true,
      );
      const writeTarget =
        explicitWriteTargets.length === 1
          ? explicitWriteTargets[0]
          : targets.length === 1 && targets[0][1].aliases[alias].is_write_index !== false
            ? targets[0]
            : undefined;
      if (!writeTarget) {
        throw new ElasticsearchSearchRequestError(
          `Elasticsearch search sync destination is not a writable alias: ${alias}`,
        );
      }
      writeTargets.set(alias, writeTarget[0]);
    }

    return writeTargets;
  }

  /** Returns each alias's unique writable physical index after validating tombstone support. */
  async getSearchSyncWriteTargets(aliases: string[]): Promise<Record<string, string>> {
    if (aliases.length === 0) return {};

    const writeTargets = await this.getSearchSyncWriteTargetMap(aliases);

    const physicalPath = [...new Set(writeTargets.values())].map(encodeURIComponent).join(',');
    const mappingResponse = await fetch(
      new URL(`/${physicalPath}/_mapping/field/search_sync_deleted`, this.url),
      {
        headers: { Authorization: `ApiKey ${this.apiKey}` },
        method: 'GET',
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      },
    );
    if (!mappingResponse.ok) {
      throw new ElasticsearchSearchRequestError(
        `Elasticsearch search sync mapping check failed (${mappingResponse.status})`,
        mappingResponse.status,
      );
    }

    const mappingPayload = fieldMappingResponseSchema.safeParse(await mappingResponse.json());
    if (!mappingPayload.success) {
      throw new ElasticsearchSearchRequestError(
        'Elasticsearch search sync mapping response has an invalid shape',
        mappingResponse.status,
        mappingPayload.error,
      );
    }

    for (const [alias, physicalIndex] of writeTargets) {
      const mapping = mappingPayload.data[physicalIndex]?.mappings.search_sync_deleted;
      if (mapping?.mapping.search_sync_deleted?.type !== 'boolean') {
        throw new ElasticsearchSearchRequestError(
          `Elasticsearch search sync alias lacks a boolean search_sync_deleted mapping: ${alias}`,
        );
      }
    }

    return Object.fromEntries(
      [...writeTargets].sort(([leftAlias], [rightAlias]) =>
        leftAlias < rightAlias ? -1 : leftAlias > rightAlias ? 1 : 0,
      ),
    );
  }

  /** Returns stable runtime identities after validating aliases, soft deletes, and reindex metadata. */
  async getSearchSyncIndexIdentities(
    aliases: string[],
  ): Promise<Record<string, ElasticsearchSearchSyncIndexIdentity>> {
    if (aliases.length === 0) return {};

    const writeTargets = await this.getSearchSyncWriteTargetMap(aliases);
    const physicalPath = [...new Set(writeTargets.values())]
      .sort()
      .map(encodeURIComponent)
      .join(',');
    const identityResponse = await fetch(
      new URL(
        `/${physicalPath}?filter_path=*.mappings,*.settings.index.analysis,*.settings.index.uuid`,
        this.url,
      ),
      {
        headers: { Authorization: `ApiKey ${this.apiKey}` },
        method: 'GET',
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      },
    );
    if (!identityResponse.ok) {
      throw new ElasticsearchSearchRequestError(
        `Elasticsearch search sync index identity check failed (${identityResponse.status})`,
        identityResponse.status,
      );
    }

    let payload: unknown;
    try {
      payload = await identityResponse.json();
    } catch {
      throw new ElasticsearchSearchRequestError(
        'Elasticsearch search sync index identity response is not valid JSON',
        identityResponse.status,
      );
    }
    const parsed = indexIdentityResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new ElasticsearchSearchRequestError(
        'Elasticsearch search sync index identity response has an invalid shape',
        identityResponse.status,
      );
    }

    const identities = new Map<string, ElasticsearchSearchSyncIndexIdentity>();
    for (const [alias, physicalIndex] of writeTargets) {
      const index = parsed.data[physicalIndex];
      if (!index) {
        throw new ElasticsearchSearchRequestError(
          `Elasticsearch search sync index identity is missing for alias: ${alias}`,
        );
      }

      identities.set(alias, {
        indexUuid: index.settings.index.uuid,
        mappingSha256: sha256Json(index.mappings),
        physicalIndex,
        reindexRunId: index.mappings._meta.reindex_run_id,
        schemaVersion: index.mappings._meta.schema_version,
        settingsSha256: sha256Json(index.settings.index.analysis),
      });
    }

    const runIdentities = new Set(
      [...identities.values()].map(({ reindexRunId, schemaVersion }) =>
        JSON.stringify([reindexRunId, schemaVersion]),
      ),
    );
    if (runIdentities.size !== 1) {
      throw new ElasticsearchSearchRequestError(
        'Elasticsearch search sync aliases do not share one reindex run identity',
      );
    }

    return Object.fromEntries(
      [...identities].sort(([leftAlias], [rightAlias]) =>
        leftAlias < rightAlias ? -1 : leftAlias > rightAlias ? 1 : 0,
      ),
    );
  }

  async bulk(body: string): Promise<ElasticsearchBulkResponse> {
    const endpoint = new URL('/_bulk?require_alias=true', this.url);
    const response = await fetch(endpoint, {
      body,
      headers: {
        'Authorization': `ApiKey ${this.apiKey}`,
        'Content-Type': 'application/x-ndjson',
      },
      method: 'POST',
      signal: AbortSignal.timeout(this.requestTimeoutMs),
    });

    if (!response.ok) {
      throw new ElasticsearchSearchRequestError(
        `Elasticsearch bulk request failed (${response.status})`,
        response.status,
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      throw new ElasticsearchSearchRequestError(
        'Elasticsearch bulk response is not valid JSON',
        response.status,
        error,
      );
    }

    const parsed = bulkResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new ElasticsearchSearchRequestError(
        'Elasticsearch bulk response has an invalid shape',
        response.status,
        parsed.error,
      );
    }

    return parsed.data;
  }

  async search(input: ElasticsearchSearchInput): Promise<ElasticsearchSearchResponse> {
    const endpoint = new URL(`/${encodeURIComponent(input.index)}/_search`, this.url);
    const body = JSON.stringify(input.body);
    const requestBytes = Buffer.byteLength(body);
    const startedAt = Date.now();
    let contentLength: number | undefined;
    let decodedBytes: number | undefined;
    let recorded = false;
    const record = (
      result: ElasticsearchSearchRequestResult,
      hits?: number,
      serverTookMs?: number,
    ) => {
      recorded = true;
      recordElasticsearchSearchRequest({
        contentLength,
        decodedBytes,
        durationMs: Date.now() - startedAt,
        entity: input.entity,
        hits,
        pagination: input.pagination,
        requestBytes,
        result,
        serverTookMs,
      });
    };

    try {
      const response = await fetch(endpoint, {
        body,
        headers: {
          'Authorization': `ApiKey ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        method: 'POST',
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
      contentLength = readContentLength(response);

      if (!response.ok) {
        record('http_error');
        throw new ElasticsearchSearchRequestError(
          `Elasticsearch search request failed (${response.status})`,
          response.status,
        );
      }

      let payload: unknown;
      try {
        const responseText = await response.text();
        decodedBytes = Buffer.byteLength(responseText);
        payload = JSON.parse(responseText);
      } catch (error) {
        record(error instanceof SyntaxError ? 'parse_error' : classifyRequestError(error));
        throw new ElasticsearchSearchRequestError(
          'Elasticsearch search response is not valid JSON',
          response.status,
          error,
        );
      }

      const parsed = searchResponseSchema.safeParse(payload);
      if (!parsed.success) {
        record('parse_error');
        throw new ElasticsearchSearchRequestError(
          'Elasticsearch search response has an invalid shape',
          response.status,
          parsed.error,
        );
      }

      record('success', parsed.data.hits.hits.length, parsed.data.took);
      return parsed.data;
    } catch (error) {
      if (!recorded) record(classifyRequestError(error));
      throw error;
    }
  }
}

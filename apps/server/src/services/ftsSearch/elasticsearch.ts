import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

import { trace } from '@lobechat/observability-otel/api';
import { z } from 'zod';

import type {
  ElasticsearchFtsSearchClient,
  ElasticsearchFtsSearchInput,
  ElasticsearchFtsSearchResponse,
} from '@/database/repositories/ftsSearch';
import { parseElasticsearchUrl } from '@/database/repositories/ftsSearch/elasticsearch/url';

import type {
  ElasticsearchFtsSearchErrorCode,
  ElasticsearchFtsSearchRequestResult,
  ElasticsearchFtsSearchTraceContext,
  FtsSearchUsage,
} from './observability';
import { recordElasticsearchFtsSearchRequest } from './observability';

const MAX_ERROR_RESPONSE_BYTES = 16_384;

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

const syncMappingResponseSchema = z.record(
  z.string(),
  z.object({
    mappings: z.object({
      properties: z.record(z.string(), z.object({ type: z.string() }).passthrough()).default({}),
    }),
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
            fts_search_sync_deleted: z.object({ type: z.literal('boolean') }).passthrough(),
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

export interface ElasticsearchFtsSearchBulkResponse {
  errors?: boolean;
  items: Array<{ index: { error?: unknown; status: number } }>;
}

export interface ElasticsearchFtsSearchHttpClientOptions {
  apiKey: string;
  requestTimeoutMs?: number;
  url: string;
  usage?: FtsSearchUsage;
}

export interface ElasticsearchFtsSearchSyncIndexIdentity {
  indexUuid: string;
  mappingSha256: string;
  physicalIndex: string;
  reindexRunId: string;
  schemaVersion: number;
  settingsSha256: string;
}

export class ElasticsearchFtsSearchRequestError extends Error {
  readonly errorCode: ElasticsearchFtsSearchErrorCode;
  readonly status?: number;

  constructor(
    message: string,
    status?: number,
    cause?: unknown,
    errorCode: ElasticsearchFtsSearchErrorCode = 'unknown_http_error',
  ) {
    super(message, { cause });
    this.name = 'ElasticsearchFtsSearchRequestError';
    this.errorCode = errorCode;
    this.status = status;
  }
}

const classifyRequestError = (error: unknown): ElasticsearchFtsSearchRequestResult =>
  error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')
    ? 'timeout'
    : 'other_error';

const readContentLength = (response: Response): number | undefined => {
  const header = response.headers.get('content-length');
  if (!header) return;
  const value = Number(header);
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
};

const readBoundedResponseText = async (response: Response): Promise<string> => {
  if (!response.body) return '';

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let completed = false;
  let totalBytes = 0;

  try {
    while (totalBytes < MAX_ERROR_RESPONSE_BYTES) {
      const result = await reader.read();
      if (result.done) {
        completed = true;
        break;
      }

      const remainingBytes = MAX_ERROR_RESPONSE_BYTES - totalBytes;
      const chunk = Buffer.from(result.value.subarray(0, remainingBytes));
      chunks.push(chunk);
      totalBytes += chunk.byteLength;
    }
  } finally {
    if (!completed) {
      try {
        await reader.cancel();
      } catch {
        // The classification fallback still uses the HTTP status when the stream cannot cancel.
      }
    }
  }

  return Buffer.concat(chunks, totalBytes).toString('utf8');
};

/** Extracts only bounded Elasticsearch error type identifiers, never free-form reasons. */
const readElasticsearchErrorTypes = (responseText: string): Set<string> => {
  const errorTypes = new Set<string>();

  for (const match of responseText.matchAll(/"type"\s*:\s*"(\w+)"/gi)) {
    if (match[1]) errorTypes.add(match[1].toLowerCase());
  }

  return errorTypes;
};

const classifyHttpError = (
  status: number,
  responseText: string,
): ElasticsearchFtsSearchErrorCode => {
  const errorTypes = readElasticsearchErrorTypes(responseText);
  if (errorTypes.has('too_many_clauses') || errorTypes.has('too_many_nested_clauses')) {
    return 'too_many_clauses';
  }
  if (status === 401) return 'authentication';
  if (status === 403) return 'authorization';
  if (status === 404 || errorTypes.has('index_not_found_exception')) return 'index_not_found';
  if (status === 413) return 'request_too_large';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'server_error';
  if (status === 400) return 'invalid_query';

  return 'unknown_http_error';
};

const getTraceDetails = (): {
  span: ReturnType<typeof trace.getActiveSpan>;
  traceContext: ElasticsearchFtsSearchTraceContext;
  traceId: string;
} => {
  const span = trace.getActiveSpan();
  if (!span) return { span, traceContext: 'missing', traceId: 'none' };

  return {
    span,
    traceContext: span.isRecording() ? 'recording' : 'non_recording',
    traceId: span.spanContext().traceId || 'none',
  };
};

/** HTTP transport that never logs credentials, request text, or Elasticsearch payloads. */
export class ElasticsearchFtsSearchHttpClient implements ElasticsearchFtsSearchClient {
  private readonly apiKey: string;
  private readonly requestTimeoutMs: number;
  private readonly url: URL;
  private readonly usage: FtsSearchUsage;

  constructor({
    apiKey,
    requestTimeoutMs = 10_000,
    url,
    usage = 'unattributed',
  }: ElasticsearchFtsSearchHttpClientOptions) {
    this.apiKey = apiKey;
    this.requestTimeoutMs = requestTimeoutMs;
    this.url = parseElasticsearchUrl(url);
    this.usage = usage;
  }

  /** Fails closed unless every incremental destination is a writable alias with tombstone support. */
  async assertFtsSearchSyncAliases(aliases: string[]): Promise<void> {
    await this.getFtsSearchSyncWriteTargets(aliases);
  }

  private async getFtsSearchSyncWriteTargetMap(aliases: string[]) {
    const aliasPath = aliases.map(encodeURIComponent).join(',');
    const aliasResponse = await fetch(new URL(`/_alias/${aliasPath}`, this.url), {
      headers: { Authorization: `ApiKey ${this.apiKey}` },
      method: 'GET',
      signal: AbortSignal.timeout(this.requestTimeoutMs),
    });
    if (!aliasResponse.ok) {
      throw new ElasticsearchFtsSearchRequestError(
        `Elasticsearch full-text search sync alias check failed (${aliasResponse.status})`,
        aliasResponse.status,
      );
    }

    let aliasJson: unknown;
    try {
      aliasJson = await aliasResponse.json();
    } catch {
      throw new ElasticsearchFtsSearchRequestError(
        'Elasticsearch full-text search sync alias response is not valid JSON',
        aliasResponse.status,
      );
    }
    const aliasPayload = aliasResponseSchema.safeParse(aliasJson);
    if (!aliasPayload.success) {
      throw new ElasticsearchFtsSearchRequestError(
        'Elasticsearch full-text search sync alias response has an invalid shape',
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
        throw new ElasticsearchFtsSearchRequestError(
          `Elasticsearch full-text search sync destination is not a writable alias: ${alias}`,
        );
      }
      writeTargets.set(alias, writeTarget[0]);
    }

    return writeTargets;
  }

  /** Returns each alias's unique writable physical index after validating tombstone support. */
  async getFtsSearchSyncWriteTargets(aliases: string[]): Promise<Record<string, string>> {
    if (aliases.length === 0) return {};

    const writeTargets = await this.getFtsSearchSyncWriteTargetMap(aliases);

    const physicalPath = [...new Set(writeTargets.values())].map(encodeURIComponent).join(',');
    const mappingResponse = await fetch(
      new URL(
        `/${physicalPath}?filter_path=*.mappings.properties.fts_search_sync_deleted`,
        this.url,
      ),
      {
        headers: { Authorization: `ApiKey ${this.apiKey}` },
        method: 'GET',
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      },
    );
    if (!mappingResponse.ok) {
      throw new ElasticsearchFtsSearchRequestError(
        `Elasticsearch full-text search sync mapping check failed (${mappingResponse.status})`,
        mappingResponse.status,
      );
    }

    const mappingPayload = syncMappingResponseSchema.safeParse(await mappingResponse.json());
    if (!mappingPayload.success) {
      throw new ElasticsearchFtsSearchRequestError(
        'Elasticsearch full-text search sync mapping response has an invalid shape',
        mappingResponse.status,
        mappingPayload.error,
      );
    }

    for (const [alias, physicalIndex] of writeTargets) {
      const mapping =
        mappingPayload.data[physicalIndex]?.mappings.properties.fts_search_sync_deleted;
      if (mapping?.type !== 'boolean') {
        throw new ElasticsearchFtsSearchRequestError(
          `Elasticsearch full-text search sync alias lacks a boolean fts_search_sync_deleted mapping: ${alias}`,
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
  async getFtsSearchSyncIndexIdentities(
    aliases: string[],
  ): Promise<Record<string, ElasticsearchFtsSearchSyncIndexIdentity>> {
    if (aliases.length === 0) return {};

    const writeTargets = await this.getFtsSearchSyncWriteTargetMap(aliases);
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
      throw new ElasticsearchFtsSearchRequestError(
        `Elasticsearch full-text search sync index identity check failed (${identityResponse.status})`,
        identityResponse.status,
      );
    }

    let payload: unknown;
    try {
      payload = await identityResponse.json();
    } catch {
      throw new ElasticsearchFtsSearchRequestError(
        'Elasticsearch full-text search sync index identity response is not valid JSON',
        identityResponse.status,
      );
    }
    const parsed = indexIdentityResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new ElasticsearchFtsSearchRequestError(
        'Elasticsearch full-text search sync index identity response has an invalid shape',
        identityResponse.status,
      );
    }

    const identities = new Map<string, ElasticsearchFtsSearchSyncIndexIdentity>();
    for (const [alias, physicalIndex] of writeTargets) {
      const index = parsed.data[physicalIndex];
      if (!index) {
        throw new ElasticsearchFtsSearchRequestError(
          `Elasticsearch full-text search sync index identity is missing for alias: ${alias}`,
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
      throw new ElasticsearchFtsSearchRequestError(
        'Elasticsearch full-text search sync aliases do not share one reindex run identity',
      );
    }

    return Object.fromEntries(
      [...identities].sort(([leftAlias], [rightAlias]) =>
        leftAlias < rightAlias ? -1 : leftAlias > rightAlias ? 1 : 0,
      ),
    );
  }

  async bulk(body: string): Promise<ElasticsearchFtsSearchBulkResponse> {
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
      throw new ElasticsearchFtsSearchRequestError(
        `Elasticsearch bulk request failed (${response.status})`,
        response.status,
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      throw new ElasticsearchFtsSearchRequestError(
        'Elasticsearch bulk response is not valid JSON',
        response.status,
        error,
      );
    }

    const parsed = bulkResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new ElasticsearchFtsSearchRequestError(
        'Elasticsearch bulk response has an invalid shape',
        response.status,
        parsed.error,
      );
    }

    return parsed.data;
  }

  async search(input: ElasticsearchFtsSearchInput): Promise<ElasticsearchFtsSearchResponse> {
    const endpoint = new URL(`/${encodeURIComponent(input.index)}/_search`, this.url);
    const body = JSON.stringify(input.body);
    const requestBytes = Buffer.byteLength(body);
    const startedAt = Date.now();
    let contentLength: number | undefined;
    let decodedBytes: number | undefined;
    let recorded = false;
    const { span, traceContext, traceId } = getTraceDetails();
    span?.setAttributes({
      'fts.search.elasticsearch.executed_query_characters': input.executedQueryChars,
      'fts.search.elasticsearch.original_query_characters': input.originalQueryChars,
      'fts.search.elasticsearch.query_field_count': input.queryFieldCount,
      'fts.search.elasticsearch.query_truncated': input.truncated,
      'fts.search.elasticsearch.trace_context': traceContext,
      'fts.search.elasticsearch.usage': this.usage,
    });
    const record = (
      result: ElasticsearchFtsSearchRequestResult,
      hits?: number,
      serverTookMs?: number,
      errorCode: ElasticsearchFtsSearchErrorCode = 'none',
    ) => {
      recorded = true;
      recordElasticsearchFtsSearchRequest({
        contentLength,
        decodedBytes,
        durationMs: Date.now() - startedAt,
        entity: input.entity,
        errorCode,
        executedQueryChars: input.executedQueryChars,
        hits,
        originalQueryChars: input.originalQueryChars,
        pagination: input.pagination,
        queryFieldCount: input.queryFieldCount,
        requestBytes,
        result,
        serverTookMs,
        traceContext,
        truncated: input.truncated,
        usage: this.usage,
      });
    };
    const logFailure = (errorCode: ElasticsearchFtsSearchErrorCode, status?: number) => {
      span?.setAttributes({
        'fts.search.elasticsearch.error_code': errorCode,
        ...(status === undefined ? {} : { 'fts.search.elasticsearch.http_status_code': status }),
      });
      console.error('[fts-search] Elasticsearch request failed', {
        entity: input.entity,
        errorCode,
        executedQueryChars: input.executedQueryChars,
        originalQueryChars: input.originalQueryChars,
        queryFieldCount: input.queryFieldCount,
        requestBytes,
        status: status ?? 0,
        traceContext,
        traceId,
        truncated: input.truncated,
        usage: this.usage,
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
        let responseText = '';
        try {
          responseText = await readBoundedResponseText(response);
        } catch {
          // HTTP status still provides a safe, bounded classification fallback.
        }
        const errorCode = classifyHttpError(response.status, responseText);
        record('http_error', undefined, undefined, errorCode);
        logFailure(errorCode, response.status);
        throw new ElasticsearchFtsSearchRequestError(
          `Elasticsearch search request failed (${response.status}, ${errorCode})`,
          response.status,
          undefined,
          errorCode,
        );
      }

      let payload: unknown;
      try {
        const responseText = await response.text();
        decodedBytes = Buffer.byteLength(responseText);
        payload = JSON.parse(responseText);
      } catch (error) {
        const result = error instanceof SyntaxError ? 'parse_error' : classifyRequestError(error);
        const errorCode = result === 'timeout' ? 'timeout' : 'response_parse_error';
        record(result, undefined, undefined, errorCode);
        logFailure(errorCode, response.status);
        throw new ElasticsearchFtsSearchRequestError(
          'Elasticsearch search response is not valid JSON',
          response.status,
          error,
          errorCode,
        );
      }

      const parsed = searchResponseSchema.safeParse(payload);
      if (!parsed.success) {
        record('parse_error', undefined, undefined, 'response_parse_error');
        logFailure('response_parse_error', response.status);
        throw new ElasticsearchFtsSearchRequestError(
          'Elasticsearch search response has an invalid shape',
          response.status,
          parsed.error,
          'response_parse_error',
        );
      }

      record('success', parsed.data.hits.hits.length, parsed.data.took);
      return parsed.data;
    } catch (error) {
      if (!recorded) {
        const result = classifyRequestError(error);
        const errorCode = result === 'timeout' ? 'timeout' : 'transport_error';
        record(result, undefined, undefined, errorCode);
        logFailure(errorCode);
      }
      throw error;
    }
  }
}

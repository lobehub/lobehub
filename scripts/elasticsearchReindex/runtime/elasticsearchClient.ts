import { isDeepStrictEqual } from 'node:util';

import { z } from 'zod';

import { resolveElasticsearchTransport } from '../../../packages/database/src/repositories/ftsSearch/elasticsearch/url';
import type {
  FtsSearchReindexAliasOutcome,
  FtsSearchReindexBulkItemResult,
  FtsSearchReindexElasticsearchClient,
  FtsSearchReindexIndexBody,
  FtsSearchReindexIndexOptions,
  FtsSearchReindexMappingUpgrade,
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

export interface ElasticsearchFtsSearchMappingPropertyResponse {
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
          schema_fingerprint: z.string().optional(),
          schema_version: z.number().int().positive().optional(),
        })
        .optional(),
      dynamic: z.union([z.boolean(), z.string()]).optional(),
      properties: z.record(z.string(), mappingPropertyResponseSchema),
    }),
  }),
);

const catIndicesResponseSchema = z.array(z.object({ index: z.string(), status: z.string() }));

const generationDetailSchema = z.record(
  z.string(),
  z.object({
    mappings: z.object({
      _meta: z
        .object({
          reindex_run_id: z.string().optional(),
          schema_fingerprint: z.string().optional(),
          schema_version: z.number().int().positive().optional(),
        })
        .passthrough()
        .optional(),
      dynamic: z.union([z.boolean(), z.string()]).optional(),
      properties: z.record(z.string(), mappingPropertyResponseSchema).default({}),
    }),
    settings: z.object({
      index: z.object({ analysis: z.record(z.string(), z.unknown()).default({}) }),
    }),
  }),
);

export interface FtsSearchReindexGenerationDescription {
  aliased: boolean;
  analysis: Record<string, unknown> | null;
  index: string;
  isWriteIndex: boolean;
  mappings: z.infer<typeof generationDetailSchema>[string]['mappings'] | null;
  meta: {
    reindex_run_id?: string;
    schema_fingerprint?: string;
    schema_version?: number;
  } | null;
  /** Closed generations are mid-retirement: sync no longer targets them, deletion comes next. */
  state: 'closed' | 'open';
  /**
   * Schema generation the index implements: `_meta.schema_version` when stamped, otherwise parsed
   * from `<alias>-v<n>`; `null` for an aliased index outside that naming scheme.
   */
  version: number | null;
}

/**
 * Version a managed generation implements. Indexes outside the `<alias>-v<n>` naming scheme are
 * never managed, whatever `_meta` they carry (for example a snapshot restored under another name).
 */
const generationVersion = (alias: string, index: string, stampedVersion: number | undefined) => {
  const built = parseGenerationVersion(alias, index);
  if (built === undefined) return null;
  return stampedVersion ?? built;
};

/** Generation number of `index` if it is named `<alias>-v<n>`. */
export const parseGenerationVersion = (alias: string, index: string): number | undefined => {
  if (!index.startsWith(`${alias}-v`)) return;
  const suffix = index.slice(alias.length + 2);
  return /^\d+$/.test(suffix) ? Number(suffix) : undefined;
};

const settingsResponseSchema = z.record(
  z.string(),
  z.object({
    settings: z.object({
      index: z.object({ analysis: z.record(z.string(), z.unknown()) }),
    }),
  }),
);

export interface FtsSearchReindexHttpClientOptions {
  /** Explicit opt-in for plaintext HTTP / no API key on a private container network. */
  allowInsecureHttp?: boolean;
  /** Required unless `allowInsecureHttp` is enabled; never sent over plaintext HTTP. */
  apiKey?: string;
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
  private readonly authorizationHeader: string | undefined;
  private readonly requestTimeoutMs: number;
  private readonly url: URL;

  constructor({
    allowInsecureHttp,
    apiKey,
    requestTimeoutMs = 30_000,
    url,
  }: FtsSearchReindexHttpClientOptions) {
    const transport = resolveElasticsearchTransport({ allowInsecureHttp, apiKey, url });
    this.authorizationHeader = transport.authorizationHeader;
    this.requestTimeoutMs = requestTimeoutMs;
    this.url = transport.url;
  }

  private async request(path: string, init: RequestInit = {}) {
    return fetch(new URL(path, this.url), {
      ...init,
      headers: {
        ...(this.authorizationHeader ? { Authorization: this.authorizationHeader } : {}),
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
    // Indexes created before fingerprints existed carry none; only a differing fingerprint is drift.
    if (
      actual._meta?.schema_fingerprint !== undefined &&
      actual._meta.schema_fingerprint !== expected.mappings._meta.schema_fingerprint
    ) {
      throw new FtsSearchReindexRequestError(
        `Elasticsearch index ${index} was built from a different v${expected.mappings._meta.schema_version} mapping than the code declares; bump the schema version and rebuild instead of resuming`,
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

  async ensureAlias(alias: string, physicalIndex: string): Promise<FtsSearchReindexAliasOutcome> {
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
        return 'existing';
      }

      /**
       * Incremental sync writes every change to all live generations of an entity, so a newer
       * generation can be backfilled while the alias keeps serving an older one. Moving the alias
       * is the explicit promote step, gated on the backfill and the Outbox catching up; a backfill
       * never moves it. Anything that is not another generation of this entity is an operator
       * error and fails closed.
       */
      if (
        targets.length === 1 &&
        parseGenerationVersion(alias, targets[0][0]) !== undefined &&
        targets[0][1].aliases[alias].is_write_index !== false
      ) {
        return 'kept_other_generation';
      }
      throw new FtsSearchReindexRequestError(
        `Elasticsearch alias ${alias} points to ${targets.map(([index]) => index).join(', ') || 'no index'} instead of a single writable ${alias}-v<n> generation`,
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
    return 'created';
  }

  /**
   * Describes every physical generation of `alias`: open ones with their `_meta`, mapping, and
   * analysis so drift can be classified, closed ones (mid-retirement) by name only, plus the
   * index the alias currently serves even if an operator named it outside the `-v<n>` scheme.
   */
  async describeGenerations(alias: string): Promise<FtsSearchReindexGenerationDescription[]> {
    const pattern = encodeURIComponent(`${alias}-v*`);
    const [catResponse, aliasResponse] = await Promise.all([
      this.request(
        `/_cat/indices/${pattern}?format=json&h=index,status&expand_wildcards=all&allow_no_indices=true`,
        { method: 'GET' },
      ),
      this.request(`/_alias/${encodeURIComponent(alias)}`, { method: 'GET' }),
    ]);
    if (!catResponse.ok) {
      throw new FtsSearchReindexRequestError(
        `Elasticsearch generation listing failed for ${alias} (${catResponse.status})`,
        catResponse.status,
      );
    }
    const catParsed = catIndicesResponseSchema.safeParse(await catResponse.json());
    if (!catParsed.success) {
      throw new FtsSearchReindexRequestError(
        `Elasticsearch generation listing has an invalid shape for ${alias}`,
        catResponse.status,
        catParsed.error,
      );
    }

    let aliasTargets: Record<string, { is_write_index?: boolean }> = {};
    if (aliasResponse.ok) {
      const parsed = aliasResponseSchema.safeParse(await aliasResponse.json());
      if (!parsed.success) {
        throw new FtsSearchReindexRequestError(
          `Elasticsearch alias response has an invalid shape for ${alias}`,
          aliasResponse.status,
          parsed.error,
        );
      }
      aliasTargets = Object.fromEntries(
        Object.entries(parsed.data)
          .filter(([, value]) => Object.hasOwn(value.aliases, alias))
          .map(([index, value]) => [index, value.aliases[alias]]),
      );
    } else if (aliasResponse.status !== 404) {
      throw new FtsSearchReindexRequestError(
        `Elasticsearch alias check failed for ${alias} (${aliasResponse.status})`,
        aliasResponse.status,
      );
    }

    const states = new Map(
      catParsed.data
        .filter(({ index }) => parseGenerationVersion(alias, index) !== undefined)
        .map(({ index, status }) => [index, status === 'close' ? 'closed' : 'open'] as const),
    );
    for (const index of Object.keys(aliasTargets)) {
      if (!states.has(index)) states.set(index, 'open');
    }

    const openIndexes = [...states].filter(([, state]) => state === 'open').map(([index]) => index);
    const details = new Map<string, z.infer<typeof generationDetailSchema>[string]>();
    if (openIndexes.length > 0) {
      const detailPath = openIndexes.map(encodeURIComponent).join(',');
      const detailResponse = await this.request(
        `/${detailPath}?filter_path=*.mappings,*.settings.index.analysis`,
        { method: 'GET' },
      );
      if (!detailResponse.ok) {
        throw new FtsSearchReindexRequestError(
          `Elasticsearch generation inspection failed for ${alias} (${detailResponse.status})`,
          detailResponse.status,
        );
      }
      const parsed = generationDetailSchema.safeParse(await detailResponse.json());
      if (!parsed.success) {
        throw new FtsSearchReindexRequestError(
          `Elasticsearch generation inspection has an invalid shape for ${alias}`,
          detailResponse.status,
          parsed.error,
        );
      }
      for (const [index, detail] of Object.entries(parsed.data)) details.set(index, detail);
    }

    return [...states]
      .map(([index, state]): FtsSearchReindexGenerationDescription => {
        const detail = details.get(index);
        return {
          aliased: Object.hasOwn(aliasTargets, index),
          analysis: detail?.settings.index.analysis ?? null,
          index,
          isWriteIndex:
            aliasTargets[index]?.is_write_index !== false && Object.hasOwn(aliasTargets, index),
          mappings: detail?.mappings ?? null,
          meta: detail?.mappings._meta ?? null,
          state,
          /**
           * An in-place upgrade advances `_meta.schema_version` without renaming the index, so the
           * stamped version wins over the `-v<n>` suffix, which only records the generation that
           * originally built the index.
           */
          version: generationVersion(alias, index, detail?.mappings._meta?.schema_version),
        };
      })
      .sort(
        (left, right) =>
          (left.version ?? -1) - (right.version ?? -1) || left.index.localeCompare(right.index),
      );
  }

  /** Atomically repoints `alias` at `to` (as write index) and removes it from every `from` index. */
  async promoteAlias(alias: string, from: readonly string[], to: string): Promise<void> {
    const response = await this.request('/_aliases', {
      body: JSON.stringify({
        actions: [
          ...from.filter((index) => index !== to).map((index) => ({ remove: { alias, index } })),
          { add: { alias, index: to, is_write_index: true } },
        ],
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    if (!response.ok) {
      throw new FtsSearchReindexRequestError(
        `Elasticsearch alias promotion failed for ${alias} (${response.status})`,
        response.status,
      );
    }
  }

  async closeIndex(index: string): Promise<void> {
    const response = await this.request(`/${encodeURIComponent(index)}/_close`, { method: 'POST' });
    if (!response.ok) {
      throw new FtsSearchReindexRequestError(
        `Elasticsearch index close failed for ${index} (${response.status})`,
        response.status,
      );
    }
  }

  async deleteIndex(index: string): Promise<void> {
    const response = await this.request(`/${encodeURIComponent(index)}`, { method: 'DELETE' });
    if (!response.ok) {
      throw new FtsSearchReindexRequestError(
        `Elasticsearch index deletion failed for ${index} (${response.status})`,
        response.status,
      );
    }
  }

  /**
   * Applies an additive mapping upgrade to a live index: Elasticsearch accepts new fields and a
   * new `_meta` on an existing index, but never a changed field. Callers classify the change first;
   * a non-additive change fails here with Elasticsearch's own error.
   */
  async putMapping(index: string, mappings: FtsSearchReindexMappingUpgrade): Promise<void> {
    const response = await this.request(`/${encodeURIComponent(index)}/_mapping`, {
      body: JSON.stringify(mappings),
      headers: { 'Content-Type': 'application/json' },
      method: 'PUT',
    });
    if (!response.ok) {
      throw new FtsSearchReindexRequestError(
        `Elasticsearch mapping upgrade failed for ${index} (${response.status})`,
        response.status,
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

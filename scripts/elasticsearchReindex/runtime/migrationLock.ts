import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import { resolveElasticsearchTransport } from '../../../packages/database/src/repositories/ftsSearch/elasticsearch/url';

const CONTROL_INDEX_MARKER = 'lobehub_fts_search_control';
const CONTROL_INDEX_SCHEMA_VERSION = 1;
const LOCK_DOCUMENT_ID = 'migration-lock';
const MAX_INDEX_NAME_BYTES = 255;
const INVALID_INDEX_NAME_CHARACTERS = /[\\/*?"<>|,\s#:]/u;

const controlMapping = {
  _meta: {
    [CONTROL_INDEX_MARKER]: true,
    schema_version: CONTROL_INDEX_SCHEMA_VERSION,
  },
  dynamic: 'strict',
  properties: {
    acquiredAt: { type: 'date' },
    command: { type: 'keyword' },
    owner: { type: 'keyword' },
  },
} as const;

const lockSourceSchema = z.object({
  acquiredAt: z.string().datetime(),
  command: z.string().min(1),
  owner: z.string().min(1),
});

const lockWriteResponseSchema = z.object({
  _primary_term: z.number().int().nonnegative(),
  _seq_no: z.number().int().nonnegative(),
});

const createIndexResponseSchema = z.object({ acknowledged: z.literal(true) });
const deleteLockResponseSchema = z.object({ result: z.literal('deleted') });

const lockReadResponseSchema = lockWriteResponseSchema.extend({
  _source: lockSourceSchema,
  found: z.literal(true),
});

const controlMappingResponseSchema = z.record(
  z.string(),
  z.object({
    mappings: z.object({
      _meta: z.record(z.string(), z.unknown()).optional(),
      dynamic: z.union([z.boolean(), z.string()]).optional(),
      properties: z.record(z.string(), z.object({ type: z.string().optional() }).passthrough()),
    }),
  }),
);

export interface FtsSearchMigrationLockClientOptions {
  /** Explicit opt-in for plaintext HTTP / no API key on a private container network. */
  allowInsecureHttp?: boolean;
  /** Required unless `allowInsecureHttp` is enabled; never sent over plaintext HTTP. */
  apiKey?: string;
  namespace: string;
  requestTimeoutMs?: number;
  url: string;
}

export interface FtsSearchMigrationLockStatus {
  acquiredAt: string;
  command: string;
  owner: string;
  primaryTerm: number;
  seqNo: number;
}

export type FtsSearchMigrationLockHandle = FtsSearchMigrationLockStatus;
export type FtsSearchMigrationLockReleaseOutcome = 'already_released' | 'released';

export class FtsSearchMigrationLockError extends Error {
  readonly recoveryOwner?: string;
  readonly status?: number;

  constructor(
    message: string,
    options: { cause?: unknown; recoveryOwner?: string; status?: number } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'FtsSearchMigrationLockError';
    this.recoveryOwner = options.recoveryOwner;
    this.status = options.status;
  }
}

const describeLock = (lock: FtsSearchMigrationLockStatus) =>
  `owner ${lock.owner}, command ${lock.command}, acquired at ${lock.acquiredAt}`;

const assertLegalIndexName = (index: string) => {
  const byteLength = new TextEncoder().encode(index).byteLength;
  if (
    index.length === 0 ||
    index === '.' ||
    index === '..' ||
    index !== index.toLowerCase() ||
    ['-', '_', '+'].some((prefix) => index.startsWith(prefix)) ||
    INVALID_INDEX_NAME_CHARACTERS.test(index) ||
    byteLength > MAX_INDEX_NAME_BYTES
  ) {
    throw new FtsSearchMigrationLockError(
      'FTS search migration namespace must produce one legal lowercase Elasticsearch index name',
    );
  }
};

/**
 * A namespace-wide, non-expiring Elasticsearch mutex for mapping migration operations.
 *
 * The lock deliberately has no lease or automatic takeover. An operator must establish that the
 * previous owner has stopped before releasing a residual lock with its exact owner token.
 */
export class FtsSearchMigrationLockClient {
  readonly controlIndex: string;

  private readonly authorizationHeader: string | undefined;
  private readonly requestTimeoutMs: number;
  private readonly url: URL;

  constructor({
    allowInsecureHttp,
    apiKey,
    namespace,
    requestTimeoutMs = 30_000,
    url,
  }: FtsSearchMigrationLockClientOptions) {
    const controlIndex = `${namespace}-fts-search-control`;
    assertLegalIndexName(controlIndex);
    const transport = resolveElasticsearchTransport({ allowInsecureHttp, apiKey, url });
    this.authorizationHeader = transport.authorizationHeader;
    this.controlIndex = controlIndex;
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

  private async readResponse(response: Response): Promise<FtsSearchMigrationLockStatus> {
    let body: unknown;
    try {
      body = await response.json();
    } catch (cause) {
      throw new FtsSearchMigrationLockError(
        'Elasticsearch migration lock response has invalid JSON',
        { cause, status: response.status },
      );
    }
    const parsed = lockReadResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new FtsSearchMigrationLockError(
        'Elasticsearch migration lock response has an invalid shape',
        { cause: parsed.error, status: response.status },
      );
    }
    return {
      ...parsed.data._source,
      primaryTerm: parsed.data._primary_term,
      seqNo: parsed.data._seq_no,
    };
  }

  private async assertControlIndexMapping(): Promise<void> {
    const response = await this.request(`/${encodeURIComponent(this.controlIndex)}/_mapping`, {
      method: 'GET',
    });
    if (!response.ok) {
      throw new FtsSearchMigrationLockError(
        `Elasticsearch migration control index verification failed (${response.status})`,
        { status: response.status },
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (cause) {
      throw new FtsSearchMigrationLockError(
        'Elasticsearch migration control index mapping has invalid JSON',
        { cause, status: response.status },
      );
    }
    const parsed = controlMappingResponseSchema.safeParse(body);
    const mappings = parsed.success ? parsed.data[this.controlIndex]?.mappings : undefined;
    const expectedTypes = controlMapping.properties;
    const actualKeys = mappings ? Object.keys(mappings.properties).sort() : [];
    const expectedKeys = Object.keys(expectedTypes).sort();
    const isOwned = mappings?._meta?.[CONTROL_INDEX_MARKER] === true;
    const isCompatible =
      mappings?.dynamic === controlMapping.dynamic &&
      mappings?._meta?.schema_version === CONTROL_INDEX_SCHEMA_VERSION &&
      actualKeys.length === expectedKeys.length &&
      actualKeys.every((key, index) => key === expectedKeys[index]) &&
      expectedKeys.every(
        (key) =>
          mappings?.properties[key]?.type === expectedTypes[key as keyof typeof expectedTypes].type,
      );

    if (!parsed.success || !isOwned || !isCompatible) {
      throw new FtsSearchMigrationLockError(
        `Elasticsearch index ${this.controlIndex} is not a compatible LobeHub FTS migration control index; refusing to overwrite it`,
      );
    }
  }

  private async ensureControlIndex(): Promise<void> {
    const response = await this.request(`/${encodeURIComponent(this.controlIndex)}`, {
      body: JSON.stringify({
        mappings: controlMapping,
        settings: { number_of_shards: 1 },
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'PUT',
    });
    if (response.ok) {
      let body: unknown;
      try {
        body = await response.json();
      } catch (cause) {
        throw new FtsSearchMigrationLockError(
          'Elasticsearch migration control index creation response has invalid JSON',
          { cause, status: response.status },
        );
      }
      const parsed = createIndexResponseSchema.safeParse(body);
      if (!parsed.success) {
        throw new FtsSearchMigrationLockError(
          'Elasticsearch migration control index creation was not acknowledged',
          { cause: parsed.error, status: response.status },
        );
      }
      return;
    }

    // Concurrent creators and an already-present index both reach this path. Verification is
    // authoritative: authentication and transport failures must never be interpreted as existence.
    if (response.status === 400 || response.status === 409) {
      await this.assertControlIndexMapping();
      return;
    }
    throw new FtsSearchMigrationLockError(
      `Elasticsearch migration control index creation failed (${response.status})`,
      { status: response.status },
    );
  }

  async acquire(command: string): Promise<FtsSearchMigrationLockHandle> {
    if (command.trim().length === 0) {
      throw new FtsSearchMigrationLockError('Migration lock command must not be empty');
    }
    await this.ensureControlIndex();

    const owner = randomUUID();
    const source = { acquiredAt: new Date().toISOString(), command, owner };
    let response: Response;
    try {
      response = await this.request(
        `/${encodeURIComponent(this.controlIndex)}/_create/${LOCK_DOCUMENT_ID}?refresh=wait_for`,
        {
          body: JSON.stringify(source),
          headers: { 'Content-Type': 'application/json' },
          method: 'PUT',
        },
      );
    } catch (cause) {
      throw new FtsSearchMigrationLockError(
        `Elasticsearch migration lock acquisition outcome is unknown; after confirming this process stopped, inspect the lock and recover with owner ${owner}`,
        { cause, recoveryOwner: owner },
      );
    }

    if (response.status === 409) {
      const current = await this.read();
      if (!current) {
        throw new FtsSearchMigrationLockError(
          'Elasticsearch reported a migration lock conflict but the current lock could not be found; retry status inspection before proceeding',
          { status: response.status },
        );
      }
      throw new FtsSearchMigrationLockError(
        `FTS search migration is already locked by ${describeLock(current)}; confirm that owner has stopped before releasing its exact token`,
        { status: response.status },
      );
    }
    if (!response.ok) {
      throw new FtsSearchMigrationLockError(
        `Elasticsearch migration lock acquisition failed (${response.status})`,
        { status: response.status },
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (cause) {
      throw new FtsSearchMigrationLockError(
        `Elasticsearch migration lock was created for owner ${owner}, but its response has invalid JSON; inspect and recover that owner after confirming this process stopped`,
        { cause, recoveryOwner: owner, status: response.status },
      );
    }
    const parsed = lockWriteResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new FtsSearchMigrationLockError(
        `Elasticsearch migration lock was created for owner ${owner}, but its response has an invalid shape; inspect and recover that owner after confirming this process stopped`,
        { cause: parsed.error, recoveryOwner: owner, status: response.status },
      );
    }
    return {
      ...source,
      primaryTerm: parsed.data._primary_term,
      seqNo: parsed.data._seq_no,
    };
  }

  /** Reads lock status without creating the control index or lock document. */
  async read(): Promise<FtsSearchMigrationLockStatus | null> {
    const response = await this.request(
      `/${encodeURIComponent(this.controlIndex)}/_doc/${LOCK_DOCUMENT_ID}`,
      { method: 'GET' },
    );
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new FtsSearchMigrationLockError(
        `Elasticsearch migration lock status failed (${response.status})`,
        { status: response.status },
      );
    }
    return this.readResponse(response);
  }

  async assertOwner(handle: FtsSearchMigrationLockHandle): Promise<void> {
    const current = await this.read();
    if (
      !current ||
      current.owner !== handle.owner ||
      current.seqNo !== handle.seqNo ||
      current.primaryTerm !== handle.primaryTerm
    ) {
      throw new FtsSearchMigrationLockError(
        `FTS search migration lock ownership was lost for owner ${handle.owner}; stop before making further changes`,
      );
    }
  }

  async release(owner: string): Promise<FtsSearchMigrationLockReleaseOutcome> {
    const current = await this.read();
    if (!current) return 'already_released';
    await this.assertControlIndexMapping();
    if (current.owner !== owner) {
      throw new FtsSearchMigrationLockError(
        `FTS search migration lock belongs to ${describeLock(current)}; refusing release for owner ${owner}`,
      );
    }

    const response = await this.request(
      `/${encodeURIComponent(this.controlIndex)}/_doc/${LOCK_DOCUMENT_ID}?if_seq_no=${current.seqNo}&if_primary_term=${current.primaryTerm}&refresh=wait_for`,
      { method: 'DELETE' },
    );
    if (response.status === 404) return 'already_released';
    if (response.status === 409) {
      throw new FtsSearchMigrationLockError(
        `FTS search migration lock changed while releasing owner ${owner}; inspect current status and do not retry with a different token`,
        { status: response.status },
      );
    }
    if (!response.ok) {
      throw new FtsSearchMigrationLockError(
        `Elasticsearch migration lock release failed (${response.status})`,
        { status: response.status },
      );
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch (cause) {
      throw new FtsSearchMigrationLockError(
        `Elasticsearch migration lock release response has invalid JSON for owner ${owner}; inspect current status before retrying`,
        { cause, status: response.status },
      );
    }
    const parsed = deleteLockResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new FtsSearchMigrationLockError(
        `Elasticsearch migration lock release response has an invalid shape for owner ${owner}; inspect current status before retrying`,
        { cause: parsed.error, status: response.status },
      );
    }
    return 'released';
  }

  async withLock<Result>(
    command: string,
    callback: (handle: FtsSearchMigrationLockHandle) => Promise<Result>,
  ): Promise<Result> {
    const handle = await this.acquire(command);
    let result: Result;
    try {
      result = await callback(handle);
    } catch (primaryError) {
      /**
       * A timed-out Elasticsearch mutation may still complete server-side. Retaining the lock keeps
       * a second owner from racing that unknown operation. Recovery is explicit after the previous
       * process is known to have stopped. Validation failures also retain the lock: this generic
       * callback can mutate checkpoints and PostgreSQL, so absence of an Elasticsearch write alone
       * cannot establish that automatic release is safe.
       */
      throw new FtsSearchMigrationLockError(
        `FTS search migration failed while holding owner ${handle.owner}; the non-expiring lock was retained, so confirm this process and any Elasticsearch request have stopped before releasing that exact owner`,
        { cause: primaryError, recoveryOwner: handle.owner },
      );
    }

    await this.release(handle.owner);
    return result;
  }
}

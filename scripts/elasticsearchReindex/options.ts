import type { FtsSearchDocumentEntity } from '@lobechat/types';
import { FTS_SEARCH_DOCUMENT_ENTITIES } from '@lobechat/types';

export interface FtsSearchReindexElasticsearchEnvironment {
  apiKeyEnvironmentName: string;
  expectedHostPrefix?: string;
  urlEnvironmentName: string;
}

export type FtsSearchReindexTelemetryEnvironment = 'development' | 'preview' | 'production';
export type FtsSearchReindexRangeEntity = 'documents' | 'messages';

const RANGE_ENTITIES = [
  'documents',
  'messages',
] as const satisfies readonly FtsSearchReindexRangeEntity[];
const BYTEWISE_DATABASE_COLLATIONS = new Set(['C', 'C.UTF-8', 'C.utf8']);

export const resolveFtsSearchReindexBatchSizeByEntity = (
  args: readonly string[],
): Partial<Record<FtsSearchDocumentEntity, number>> => {
  const name = '--entity-batch-size';
  const result: Partial<Record<FtsSearchDocumentEntity, number>> = {};
  for (const argument of args.filter((item) => item.startsWith(`${name}=`))) {
    const value = argument.slice(name.length + 1);
    const parts = value.split(':');
    if (parts.length !== 2) throw new Error(`${name} must use <entity>:<positive-integer>`);
    const [entityName, sizeText] = parts;
    const entity = FTS_SEARCH_DOCUMENT_ENTITIES.find((item) => item === entityName);
    if (!entity) throw new Error(`${name} names an unknown search entity: ${entityName}`);
    if (!/^[1-9]\d*$/.test(sizeText)) {
      throw new Error(`${name} must use <entity>:<positive-integer>`);
    }
    const size = Number(sizeText);
    if (!Number.isSafeInteger(size)) {
      throw new Error(`${name} must use <entity>:<positive-integer>`);
    }
    if (result[entity] !== undefined) {
      throw new Error(`${name} was provided more than once for ${entity}`);
    }
    result[entity] = size;
  }
  return result;
};

export const resolveFtsSearchReindexRangeConcurrencyByEntity = (
  args: readonly string[],
): Partial<Record<FtsSearchReindexRangeEntity, number>> => {
  const name = '--entity-range-concurrency';
  const result: Partial<Record<FtsSearchReindexRangeEntity, number>> = {};
  for (const argument of args.filter((item) => item.startsWith(`${name}=`))) {
    const value = argument.slice(name.length + 1);
    const parts = value.split(':');
    if (parts.length !== 2) throw new Error(`${name} must use <entity>:<positive-integer>`);
    const [entityName, concurrencyText] = parts;
    const entity = RANGE_ENTITIES.find((item) => item === entityName);
    if (!entity) {
      throw new Error(`${name} supports only documents and messages: ${entityName}`);
    }
    if (!/^[1-9]\d*$/.test(concurrencyText)) {
      throw new Error(`${name} must use <entity>:<positive-integer>`);
    }
    const concurrency = Number(concurrencyText);
    if (!Number.isSafeInteger(concurrency)) {
      throw new Error(`${name} must use <entity>:<positive-integer>`);
    }
    if (result[entity] !== undefined) {
      throw new Error(`${name} was provided more than once for ${entity}`);
    }
    result[entity] = concurrency;
  }
  return result;
};

export const resolveFtsSearchReindexEntities = (
  args: readonly string[],
): FtsSearchDocumentEntity[] | undefined => {
  const name = '--entity';
  const requested = args
    .filter((item) => item.startsWith(`${name}=`))
    .map((argument) => argument.slice(name.length + 1));
  if (requested.length === 0) return;

  const entities = requested.map((entityName) => {
    const entity = FTS_SEARCH_DOCUMENT_ENTITIES.find((item) => item === entityName);
    if (!entity) throw new Error(`${name} names an unknown search entity: ${entityName}`);
    return entity;
  });
  if (new Set(entities).size !== entities.length) {
    throw new Error(`${name} was provided more than once for the same entity`);
  }
  return entities;
};

export const assertFtsSearchReindexRangeCollation = (
  databaseCollation: string,
  concurrencyByEntity: Partial<Record<FtsSearchReindexRangeEntity, number>>,
) => {
  if (
    Object.values(concurrencyByEntity).some((concurrency) => concurrency > 1) &&
    !BYTEWISE_DATABASE_COLLATIONS.has(databaseCollation)
  ) {
    throw new Error(
      `Parallel FTS reindex ID ranges require a bytewise database collation; received ${databaseCollation}`,
    );
  }
};

const readEnvironmentVariableNameArgument = (args: readonly string[], name: string) => {
  const argument = args.find((item) => item.startsWith(`${name}=`));
  if (!argument) return;
  const value = argument.slice(name.length + 1);
  if (!/^[A-Z][A-Z0-9_]*$/.test(value)) {
    throw new Error(`${name} must name an uppercase environment variable`);
  }
  return value;
};

const readHostPrefixArgument = (args: readonly string[]) => {
  const name = '--expected-elasticsearch-host-prefix';
  const argument = args.find((item) => item.startsWith(`${name}=`));
  if (!argument) return;
  const value = argument.slice(name.length + 1).toLowerCase();
  if (!/^[a-z\d][a-z\d.-]*$/.test(value)) {
    throw new Error(`${name} must be a valid lowercase hostname prefix`);
  }
  return value;
};

export const resolveFtsSearchReindexElasticsearchEnvironment = (
  args: readonly string[],
): FtsSearchReindexElasticsearchEnvironment => {
  const apiKeyEnvironmentName = readEnvironmentVariableNameArgument(
    args,
    '--elasticsearch-api-key-env',
  );
  const urlEnvironmentName = readEnvironmentVariableNameArgument(args, '--elasticsearch-url-env');
  if (Boolean(apiKeyEnvironmentName) !== Boolean(urlEnvironmentName)) {
    throw new Error(
      '--elasticsearch-url-env and --elasticsearch-api-key-env must be provided together',
    );
  }
  return {
    apiKeyEnvironmentName: apiKeyEnvironmentName ?? 'ES_API_KEY',
    expectedHostPrefix: readHostPrefixArgument(args),
    urlEnvironmentName: urlEnvironmentName ?? 'ES_URL',
  };
};

export const resolveFtsSearchReindexTelemetryEnvironment = (
  args: readonly string[],
): FtsSearchReindexTelemetryEnvironment | undefined => {
  const name = '--telemetry-environment';
  const argument = args.find((item) => item.startsWith(`${name}=`));
  if (!argument) return;
  const value = argument.slice(name.length + 1);
  if (value !== 'development' && value !== 'preview' && value !== 'production') {
    throw new Error(`${name} must be one of development, preview, or production`);
  }
  return value;
};

export const assertFtsSearchReindexTelemetryExportConfigured = (
  environment: Readonly<Record<string, string | undefined>>,
) => {
  const sharedEndpoint = Boolean(environment.OTEL_EXPORTER_OTLP_ENDPOINT);
  const hasMetricsEndpoint =
    sharedEndpoint || Boolean(environment.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT);
  const hasTracesEndpoint =
    sharedEndpoint || Boolean(environment.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT);
  if (!hasMetricsEndpoint || !hasTracesEndpoint) {
    throw new Error(
      'OTLP metrics and traces export endpoints are required: set OTEL_EXPORTER_OTLP_ENDPOINT or both signal-specific endpoint variables',
    );
  }
};

export const assertFtsSearchReindexElasticsearchHostname = (
  hostname: string,
  expectedHostPrefix?: string,
) => {
  if (expectedHostPrefix && !hostname.toLowerCase().startsWith(expectedHostPrefix)) {
    throw new Error(
      `Elasticsearch hostname ${hostname} does not match required prefix ${expectedHostPrefix}`,
    );
  }
};

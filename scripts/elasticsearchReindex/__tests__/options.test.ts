import { describe, expect, it } from 'vitest';

import {
  assertFtsSearchReindexElasticsearchHostname,
  assertFtsSearchReindexTelemetryExportConfigured,
  resolveFtsSearchReindexElasticsearchEnvironment,
  resolveFtsSearchReindexTelemetryEnvironment,
} from '../options';

describe('resolveFtsSearchReindexElasticsearchEnvironment', () => {
  it('uses the canonical pair by default', () => {
    expect(resolveFtsSearchReindexElasticsearchEnvironment([])).toEqual({
      apiKeyEnvironmentName: 'ES_API_KEY',
      urlEnvironmentName: 'ES_URL',
    });
  });

  it('selects an explicit endpoint and credential pair without reading their values', () => {
    expect(
      resolveFtsSearchReindexElasticsearchEnvironment([
        '--elasticsearch-url-env=DEV_SEARCH_ES_URL',
        '--elasticsearch-api-key-env=DEV_SEARCH_ES_API_KEY',
        '--expected-elasticsearch-host-prefix=dev-search-',
      ]),
    ).toEqual({
      apiKeyEnvironmentName: 'DEV_SEARCH_ES_API_KEY',
      expectedHostPrefix: 'dev-search-',
      urlEnvironmentName: 'DEV_SEARCH_ES_URL',
    });
  });

  it('refuses a partial pair or a non-environment-variable name', () => {
    expect(() =>
      resolveFtsSearchReindexElasticsearchEnvironment([
        '--elasticsearch-url-env=DEV_SEARCH_ES_URL',
      ]),
    ).toThrow('must be provided together');
    expect(() =>
      resolveFtsSearchReindexElasticsearchEnvironment([
        '--elasticsearch-url-env=../../secret',
        '--elasticsearch-api-key-env=ES_API_KEY',
      ]),
    ).toThrow('must name an uppercase environment variable');
  });

  it('refuses a hostname outside the explicitly required target prefix', () => {
    expect(() =>
      assertFtsSearchReindexElasticsearchHostname('production-search.example.com', 'dev-search-'),
    ).toThrow('does not match required prefix');
    expect(() =>
      assertFtsSearchReindexElasticsearchHostname('dev-search-abc.example.com', 'dev-search-'),
    ).not.toThrow();
  });
});

describe('resolveFtsSearchReindexTelemetryEnvironment', () => {
  it('requires an explicit, bounded environment label when provided', () => {
    expect(resolveFtsSearchReindexTelemetryEnvironment([])).toBeUndefined();
    expect(
      resolveFtsSearchReindexTelemetryEnvironment(['--telemetry-environment=development']),
    ).toBe('development');
    expect(() =>
      resolveFtsSearchReindexTelemetryEnvironment(['--telemetry-environment=Production']),
    ).toThrow('must be one of development, preview, or production');
    expect(() =>
      resolveFtsSearchReindexTelemetryEnvironment(['--telemetry-environment=staging']),
    ).toThrow('must be one of development, preview, or production');
  });
});

describe('assertFtsSearchReindexTelemetryExportConfigured', () => {
  it('accepts a shared OTLP endpoint', () => {
    expect(() =>
      assertFtsSearchReindexTelemetryExportConfigured({
        OTEL_EXPORTER_OTLP_ENDPOINT: 'https://collector.example.com',
      }),
    ).not.toThrow();
  });

  it('accepts separate metrics and traces endpoints', () => {
    expect(() =>
      assertFtsSearchReindexTelemetryExportConfigured({
        OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: 'https://collector.example.com/v1/metrics',
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'https://collector.example.com/v1/traces',
      }),
    ).not.toThrow();
  });

  it('refuses telemetry without both export destinations', () => {
    expect(() => assertFtsSearchReindexTelemetryExportConfigured({})).toThrow(
      'OTLP metrics and traces export endpoints are required',
    );
    expect(() =>
      assertFtsSearchReindexTelemetryExportConfigured({
        OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: 'https://collector.example.com/v1/metrics',
      }),
    ).toThrow('OTLP metrics and traces export endpoints are required');
    expect(() =>
      assertFtsSearchReindexTelemetryExportConfigured({
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'https://collector.example.com/v1/traces',
      }),
    ).toThrow('OTLP metrics and traces export endpoints are required');
  });
});

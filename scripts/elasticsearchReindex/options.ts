export interface FtsSearchReindexElasticsearchEnvironment {
  apiKeyEnvironmentName: string;
  expectedHostPrefix?: string;
  urlEnvironmentName: string;
}

export type FtsSearchReindexTelemetryEnvironment = 'development' | 'preview' | 'production';

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

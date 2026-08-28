export interface SearchReindexElasticsearchEnvironment {
  apiKeyEnvironmentName: string;
  expectedHostPrefix?: string;
  urlEnvironmentName: string;
}

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

export const resolveSearchReindexElasticsearchEnvironment = (
  args: readonly string[],
): SearchReindexElasticsearchEnvironment => {
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

export const assertSearchReindexElasticsearchHostname = (
  hostname: string,
  expectedHostPrefix?: string,
) => {
  if (expectedHostPrefix && !hostname.toLowerCase().startsWith(expectedHostPrefix)) {
    throw new Error(
      `Elasticsearch hostname ${hostname} does not match required prefix ${expectedHostPrefix}`,
    );
  }
};

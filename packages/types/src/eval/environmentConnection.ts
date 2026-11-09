import type { EvalCaseEnvironment } from './agentEval';

const PREFIX = 'env:';

/** The connector id a binding uses for a connection stored in an Environment. */
export const environmentConnectionId = (environmentId: string, service: string) =>
  `${PREFIX}${environmentId}:${service}`;

/** The Environment and service an `env:` connector id names, or undefined for a connector row. */
export const parseEnvironmentConnectionId = (
  connectorId: string,
): { environmentId: string; service: string } | undefined => {
  if (!connectorId.startsWith(PREFIX)) return;
  const rest = connectorId.slice(PREFIX.length);
  const separator = rest.indexOf(':');
  if (separator <= 0 || separator === rest.length - 1) return;
  return { environmentId: rest.slice(0, separator), service: rest.slice(separator + 1) };
};

/** An Environment config as it may leave the server: connection credentials removed. */
export const redactEnvironmentConnections = <T extends EvalCaseEnvironment | null | undefined>(
  config: T,
): T => {
  if (!config?.connections) return config;
  return {
    ...config,
    connections: Object.fromEntries(
      Object.entries(config.connections).map(([service, connection]) => [
        service,
        {
          hasCredentials: !!connection.credentials,
          ...(connection.name && { name: connection.name }),
          url: connection.url,
        },
      ]),
    ),
  };
};

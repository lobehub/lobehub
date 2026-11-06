import { toRecord } from '@lobechat/utils/object';

/** Reuse the same credential/header mapping for local HTTP calls and resource reads. */
export const localConnectorHttpParams = (connector: {
  credentials?: unknown;
  identifier: string;
  mcpServerUrl?: string | null;
  metadata?: Record<string, unknown> | null;
}) => {
  const credentials = toRecord(connector.credentials) ?? {};
  const token = credentials.type === 'apikey' ? credentials.apiKey : credentials.token;
  const auth =
    credentials.type === 'oauth2' && typeof credentials.accessToken === 'string'
      ? { accessToken: credentials.accessToken, type: 'oauth2' as const }
      : typeof token === 'string'
        ? { token, type: 'bearer' as const }
        : undefined;
  const rawHeaders = {
    ...(credentials.type === 'header' ? toRecord(credentials.headers) : {}),
    ...toRecord(connector.metadata?.customHeaders),
  };
  const headers = Object.fromEntries(
    Object.entries(rawHeaders).filter(
      (item): item is [string, string] => typeof item[1] === 'string',
    ),
  );
  if (!connector.mcpServerUrl) throw new Error('Connector has no HTTP endpoint');
  return {
    auth,
    headers: Object.keys(headers).length ? headers : undefined,
    name: connector.identifier,
    url: connector.mcpServerUrl,
  };
};

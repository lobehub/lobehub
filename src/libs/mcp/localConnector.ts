import { resolveConnectorLinkParam, splitConnectorLinkArg } from '@lobechat/mecha';
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

/**
 * The HTTP params a call this desktop runs itself sends, with an OAuth
 * connector's access token: the edit read leaves OAuth tokens out, so it is
 * fetched (`connector.getLocalCallToken`, refreshed when due) when the
 * connector has an OAuth flow configured and no user-set credential.
 */
export const resolveLocalConnectorHttpParams = async (
  connector: Parameters<typeof localConnectorHttpParams>[0] & {
    id: string;
    oidcConfig?: unknown;
  },
  getLocalCallToken: (id: string) => Promise<{ accessToken: string; type: 'oauth2' } | null>,
) => {
  const http = localConnectorHttpParams(connector);
  if (http.auth || !connector.oidcConfig) return http;

  const oauth = await getLocalCallToken(connector.id);
  return oauth
    ? { ...http, auth: { accessToken: oauth.accessToken, type: 'oauth2' as const } }
    : http;
};

/**
 * The account a call this desktop runs itself goes out as, for a connector
 * with accounts (`links`): the model's selector, or the one a view's call
 * carries, taken out of the arguments the MCP server receives. As its
 * server-run calls do, a connector holding several fails without a selection,
 * and a selection is kept with one account left: a call made for an account
 * removed since must fail rather than go out as the one that remains.
 */
export const takeLocalConnectorAccount = (
  connector: { links?: readonly unknown[] | null },
  tools: readonly { inputSchema?: unknown }[],
  args: string | undefined,
  selected?: string,
): { args: string; linkId?: string } => {
  const accounts = connector.links?.length ?? 0;
  if (!accounts) return { args: args || '{}', linkId: selected };
  const param = resolveConnectorLinkParam(tools.map((tool) => tool.inputSchema));
  const split = splitConnectorLinkArg(args || '{}', param);
  if (selected && split.linkId && selected !== split.linkId)
    throw new Error('Conflicting account selections');
  const linkId = selected ?? split.linkId;
  if (!linkId && accounts > 1)
    throw new Error(`${param} is required: select one of the accounts listed for this tool`);
  return { args: split.argsStr, linkId };
};

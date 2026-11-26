import { type LobeToolCustomPlugin } from '@lobechat/types';
import { isDeviceOnlyMcpEndpoint } from '@lobechat/utils/mcpEndpoint';

// The form keeps values of unmounted conditional fields, so switching transport or auth type
// would otherwise persist the abandoned branch (e.g. a bearer token after choosing "none").
export const pruneHiddenFields = (values: LobeToolCustomPlugin): LobeToolCustomPlugin => {
  const mcp = values.customParams?.mcp;
  if (!mcp || (mcp.type !== 'http' && mcp.type !== 'stdio')) return values;

  const { args, auth, boundDeviceId, command, connectVia, env, headers, url, ...rest } = mcp;

  let nextMcp: typeof mcp;
  if (mcp.type === 'stdio') {
    // Stdio always runs on the device: there is no connection to choose
    nextMcp = { ...rest, args, ...(boundDeviceId && { boundDeviceId }), command, env };
  } else {
    let nextAuth = auth;
    if (auth) {
      const { accessToken, clientId, clientSecret, token, ...authRest } = auth;
      nextAuth = {
        ...authRest,
        ...(auth.type === 'bearer' && { token }),
        ...(auth.type === 'oauth2' && { accessToken, clientId, clientSecret }),
      };
    }
    // A device binding only applies to a server reached from the device
    const keepsBinding =
      !!boundDeviceId && isDeviceOnlyMcpEndpoint({ connectVia, type: 'http', url });
    nextMcp = {
      ...rest,
      auth: nextAuth,
      ...(keepsBinding && { boundDeviceId }),
      connectVia,
      headers,
      url,
    };
  }

  return { ...values, customParams: { ...values.customParams, mcp: nextMcp } };
};

import { type LobeToolCustomPlugin } from '@lobechat/types';

// The form keeps values of unmounted conditional fields, so switching transport or auth type
// would otherwise persist the abandoned branch (e.g. a bearer token after choosing "none").
export const pruneHiddenFields = (values: LobeToolCustomPlugin): LobeToolCustomPlugin => {
  const mcp = values.customParams?.mcp;
  if (!mcp || (mcp.type !== 'http' && mcp.type !== 'stdio')) return values;

  const { args, auth, command, env, headers, url, ...rest } = mcp;

  let nextMcp: typeof mcp;
  if (mcp.type === 'stdio') {
    nextMcp = { ...rest, args, command, env };
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
    nextMcp = { ...rest, auth: nextAuth, headers, url };
  }

  return { ...values, customParams: { ...values.customParams, mcp: nextMcp } };
};

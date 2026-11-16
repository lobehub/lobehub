import { type LobeToolCustomPlugin } from '@lobechat/types';

import { type OAuthNotice } from './MCPManifestForm';

/** The OAuth fields that decide whether a save has to authorize. */
export interface DevModalOAuthFields {
  clientId?: string;
  clientSecret?: string;
  url?: string;
}

export interface DevModalOAuthPlan {
  /** Saving opens the authorization window; otherwise it saves in place. */
  authorize: boolean;
  notice?: OAuthNotice;
}

/** Without a caller-supplied plan every OAuth save authorizes (creating has nothing to keep). */
export const AUTHORIZE_ALWAYS: DevModalOAuthPlan = { authorize: true };

const readMcp = (values: LobeToolCustomPlugin) =>
  values.customParams?.mcp as
    | { auth?: { clientId?: string; clientSecret?: string; type?: string }; url?: string }
    | undefined;

export const readOAuthFields = (values: LobeToolCustomPlugin): DevModalOAuthFields => {
  const mcp = readMcp(values);
  return { clientId: mcp?.auth?.clientId, clientSecret: mcp?.auth?.clientSecret, url: mcp?.url };
};

/**
 * What the save button does with the values being saved: authorize (open the
 * window inside the click, before validation or network IO) or save in place.
 * Only the connector-backed OAuth auth type can authorize.
 */
export const planOAuthSave = ({
  enableOAuth,
  getOAuthPlan,
  values,
}: {
  enableOAuth?: boolean;
  getOAuthPlan?: (fields: DevModalOAuthFields) => DevModalOAuthPlan;
  values: LobeToolCustomPlugin;
}): DevModalOAuthPlan => {
  if (!enableOAuth || readMcp(values)?.auth?.type !== 'oauth2') return { authorize: false };
  return getOAuthPlan?.(readOAuthFields(values)) ?? AUTHORIZE_ALWAYS;
};

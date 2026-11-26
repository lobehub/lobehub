/**
 * `purpose` claims of tokens that only the device gateway accepts. They are
 * signed with the same key as access tokens, so every LobeHub server login
 * verifier must reject them.
 */

/** A managed cloud device's connect token. */
export const MANAGED_DEVICE_JWT_PURPOSE = 'managed-device';

/** A workspace device's connect token. */
export const WORKSPACE_DEVICE_CONNECT_JWT_PURPOSE = 'workspace-device-connect';

/** The one-shot entry ticket of a tunnel link. */
export const TUNNEL_ACCESS_JWT_PURPOSE = 'tunnel-access';

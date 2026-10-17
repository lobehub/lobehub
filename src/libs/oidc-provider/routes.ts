/**
 * Public paths of the OIDC provider, shared by the provider configuration and
 * the settings page that shows developers where to point their clients.
 *
 * Every route carries the `/oidc` prefix because the provider is mounted under
 * it and receives the untouched pathname; a route left at its default (e.g.
 * `/jwks`) would be unreachable.
 */
export const OIDC_ISSUER_PATH = '/oidc';

export const OIDC_ROUTES = {
  authorization: '/oidc/auth',
  code_verification: '/oidc/device',
  device_authorization: '/oidc/device/auth',
  end_session: '/oidc/session/end',
  jwks: '/oidc/jwks',
  token: '/oidc/token',
  userinfo: '/oidc/me',
} as const;

/** Where clients fetch discovery: the issuer plus the well-known suffix. */
export const OIDC_DISCOVERY_PATH = '/oidc/.well-known/openid-configuration';

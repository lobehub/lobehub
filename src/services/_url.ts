export const API_ENDPOINTS = {
  oauth: '/api/auth',

  // trace
  trace: '/webapi/trace',

  // chat
  chat: (provider: string) => `/webapi/chat/${provider}`,

  // models
  models: (provider: string) => `/webapi/models/${provider}`,
  modelPull: (provider: string) => `/webapi/models/${provider}/pull`,
  pricing: (provider: string) => `/webapi/models/${provider}/pricing`,

  // TTS
  tts: (provider: string) => `/webapi/tts/${provider}`,
};

export const MARKET_OIDC_ENDPOINTS = {
  // NOTE: `auth` is used to open a page in the system browser (desktop) / popup (web),
  // so it must always be an HTTP(S) path joined with `NEXT_PUBLIC_MARKET_BASE_URL`.
  // It MUST NOT be wrapped by the Electron backend protocol.
  auth: '/lobehub-oidc/auth',
  token: '/market/oidc/token',
  userinfo: '/market/oidc/userinfo',
  handoff: '/market/oidc/handoff',
  // Same as `auth`: used as `redirect_uri` (must be a real web URL under market base).
  desktopCallback: '/lobehub-oidc/callback/desktop',
};

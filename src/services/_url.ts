export const API_ENDPOINTS = {
  oauth: '/api/auth',

  // trace
  trace: '/webapi/trace',

  // chat
  chat: (provider: string) => `/webapi/chat/${provider}`,

  // models
  models: (provider: string) => `/webapi/models/${provider}`,
  modelPull: (provider: string) => `/webapi/models/${provider}/pull`,

  // STT
  stt: '/webapi/stt/openai',

  // TTS
  tts: (provider: string) => `/webapi/tts/${provider}`,
  edge: '/webapi/tts/edge',
  microsoft: '/webapi/tts/microsoft',
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

export const MARKET_ENDPOINTS = {
  base: '/market',
  // Agent management
  createAgent: '/market/agent/create',
  getAgentDetail: (identifier: string) => `/market/agent/${encodeURIComponent(identifier)}`,
  getOwnAgents: '/market/agent/own',
  createAgentVersion: '/market/agent/versions/create',
  // Agent status management
  publishAgent: (identifier: string) => `/market/agent/${encodeURIComponent(identifier)}/publish`,
  unpublishAgent: (identifier: string) =>
    `/market/agent/${encodeURIComponent(identifier)}/unpublish`,
  deprecateAgent: (identifier: string) =>
    `/market/agent/${encodeURIComponent(identifier)}/deprecate`,
  // User profile
  getUserProfile: (username: string) => `/market/user/${encodeURIComponent(username)}`,
  updateUserProfile: '/market/user/me',

  // Social - Follow
  follow: '/market/social/follow',
  unfollow: '/market/social/unfollow',
  followStatus: (userId: number) => `/market/social/follow-status/${userId}`,
  following: (userId: number) => `/market/social/following/${userId}`,
  followers: (userId: number) => `/market/social/followers/${userId}`,
  followCounts: (userId: number) => `/market/social/follow-counts/${userId}`,

  // Social - Favorite
  favorite: '/market/social/favorite',
  unfavorite: '/market/social/unfavorite',
  favoriteStatus: (targetType: 'agent' | 'plugin', targetIdOrIdentifier: number | string) =>
    `/market/social/favorite-status/${targetType}/${encodeURIComponent(targetIdOrIdentifier)}`,
  myFavorites: '/market/social/favorites',
  userFavorites: (userId: number) => `/market/social/user-favorites/${userId}`,
  favoriteAgents: (userId: number) => `/market/social/favorite-agents/${userId}`,
  favoritePlugins: (userId: number) => `/market/social/favorite-plugins/${userId}`,

  // Social - Like
  like: '/market/social/like',
  unlike: '/market/social/unlike',
  toggleLike: '/market/social/toggle-like',
  likeStatus: (targetType: 'agent' | 'plugin', targetIdOrIdentifier: number | string) =>
    `/market/social/like-status/${targetType}/${encodeURIComponent(targetIdOrIdentifier)}`,
  likedAgents: (userId: number) => `/market/social/liked-agents/${userId}`,
  likedPlugins: (userId: number) => `/market/social/liked-plugins/${userId}`,
};

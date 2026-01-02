interface AuthConfig {
  apiKey?: string | null;
  oauthAuthorized?: boolean;
}

export const checkAuth = ({ apiKey, oauthAuthorized }: AuthConfig) => {
  // If authorized by oauth
  if (oauthAuthorized) {
    return { auth: true };
  }

  // if apiKey exist
  if (apiKey) {
    return { auth: true };
  }

  return { auth: true };
};

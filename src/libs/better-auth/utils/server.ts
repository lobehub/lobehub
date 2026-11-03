/**
 * Parse Better-Auth SSO providers from environment variable
 * Supports comma-separated list (both English and Chinese commas)
 * @param providersEnv - Raw environment variable value (e.g., "google,github")
 * @returns Array of enabled provider names
 */
export const parseSSOProviders = (providersEnv?: string): string[] => {
  const providers = providersEnv?.trim();

  if (!providers) {
    return [];
  }

  return providers
    .split(/[,，]/)
    .map((p) => p.trim())
    .filter(Boolean);
};

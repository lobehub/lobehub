export interface SkillToolsClient {
  listLiveTools?: (providerId: string, options?: RequestInit) => Promise<any>;
  listTools: (providerId: string, options?: RequestInit) => Promise<any>;
}

/**
 * Each request gets its own timeout budget so a hanging live probe cannot
 * starve the static fallback that follows it.
 */
const requestOptions = (timeoutMs?: number): [RequestInit] | [] =>
  timeoutMs ? [{ signal: AbortSignal.timeout(timeoutMs) }] : [];

export const listSkillToolsWithLiveFallback = async (
  skills: SkillToolsClient,
  providerId: string,
  onLiveDiscoveryError?: (error: unknown) => void,
  timeoutMs?: number,
) => {
  if (typeof skills.listLiveTools === 'function') {
    try {
      const response = await skills.listLiveTools(providerId, ...requestOptions(timeoutMs));
      if (Array.isArray(response?.tools) && response.tools.length > 0) return response;
    } catch (error) {
      onLiveDiscoveryError?.(error);
    }
  }

  return skills.listTools(providerId, ...requestOptions(timeoutMs));
};

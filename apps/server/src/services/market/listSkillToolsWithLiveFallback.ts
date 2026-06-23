export interface SkillToolsClient {
  listLiveTools?: (providerId: string) => Promise<any>;
  listTools: (providerId: string) => Promise<any>;
}

export const listSkillToolsWithLiveFallback = async (
  skills: SkillToolsClient,
  providerId: string,
  onLiveDiscoveryError?: (error: unknown) => void,
) => {
  if (typeof skills.listLiveTools === 'function') {
    try {
      const response = await skills.listLiveTools(providerId);
      if (Array.isArray(response?.tools) && response.tools.length > 0) return response;
    } catch (error) {
      onLiveDiscoveryError?.(error);
    }
  }

  return skills.listTools(providerId);
};

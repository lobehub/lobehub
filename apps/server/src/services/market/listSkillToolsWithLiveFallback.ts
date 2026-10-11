export interface SkillToolsClient {
  listLiveTools?: (providerId: string, options?: RequestInit) => Promise<any>;
  listTools: (providerId: string, options?: RequestInit) => Promise<any>;
}

/** Which path produced a tool list: the provider's live probe, or the static catalog fallback. */
export type SkillToolsDiscoverySource = 'live' | 'static';

/**
 * A provider's tool list plus the {@link SkillToolsDiscoverySource} it came from.
 * The source rides along because a `static` answer is a substitute, not a real
 * observation — a caller that caches the result must remember only a `live`
 * answer and retry the fallback on the next call.
 */
export type SkillToolsDiscovery = {
  /** Provider-authored usage notes, appended to the manifest's system role. */
  instruction?: string;
  source: SkillToolsDiscoverySource;
  tools?: unknown[];
} & Record<string, unknown>;

/**
 * Each request gets its own timeout budget so a hanging live probe cannot
 * starve the static fallback that follows it.
 */
const requestOptions = (timeoutMs?: number): [RequestInit] | [] =>
  timeoutMs ? [{ signal: AbortSignal.timeout(timeoutMs) }] : [];

/**
 * Prefer the provider's live tool list, falling back to the static catalog when
 * the live probe is unavailable, errors, times out, or returns no tools.
 *
 * The result always carries `source`, so a caller can tell a successful live
 * probe from the fallback even when both return a nonempty tool list.
 */
export const listSkillToolsWithLiveFallback = async (
  skills: SkillToolsClient,
  providerId: string,
  onLiveDiscoveryError?: (error: unknown) => void,
  timeoutMs?: number,
): Promise<SkillToolsDiscovery> => {
  if (typeof skills.listLiveTools === 'function') {
    try {
      const response = await skills.listLiveTools(providerId, ...requestOptions(timeoutMs));
      if (Array.isArray(response?.tools) && response.tools.length > 0) {
        return { ...response, source: 'live' };
      }
    } catch (error) {
      onLiveDiscoveryError?.(error);
    }
  }

  const fallback = await skills.listTools(providerId, ...requestOptions(timeoutMs));
  return { ...fallback, source: 'static' };
};

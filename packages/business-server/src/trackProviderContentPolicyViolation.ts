export interface TrackProviderContentPolicyViolationParams {
  error: unknown;
  model?: string;
  provider: string;
  trigger?: string;
  userId?: string;
}

export const trackProviderContentPolicyViolation = async (
  _params: TrackProviderContentPolicyViolationParams,
): Promise<void> => {};

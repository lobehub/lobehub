export interface ProviderContentPolicyErrorDetails {
  message: string;
  retryAt?: string;
}

export interface ProviderContentPolicyViolationTrackingContext {
  apiType?: string;
  channelId?: string;
  generationBatchId?: string;
  generationId?: string;
  model?: string;
  optionIndex?: number;
  routerId?: string;
  taskId?: string;
  traceId?: string;
}

export interface GetProviderContentPolicyErrorParams {
  error: unknown;
  provider: string;
  /**
   * Awaited image-generation tracking context. Cloud uses this to persist the current
   * violation before resolving the notice, while the later route-attempt callback is
   * deduplicated by `generationBatchId`.
   */
  tracking?: ProviderContentPolicyViolationTrackingContext;
  trigger?: string;
  userId?: string;
}

export const getProviderContentPolicyErrorDetails = async (
  _params: GetProviderContentPolicyErrorParams,
): Promise<ProviderContentPolicyErrorDetails | undefined> => undefined;

export const getProviderContentPolicyErrorMessage = async (
  params: GetProviderContentPolicyErrorParams,
): Promise<string | undefined> => (await getProviderContentPolicyErrorDetails(params))?.message;

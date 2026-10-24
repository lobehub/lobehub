export interface ProviderContentPolicyErrorDetails {
  message: string;
  retryAt?: string;
}

export interface GetProviderContentPolicyErrorParams {
  error: unknown;
  provider: string;
  trigger?: string;
  userId?: string;
}

export const getProviderContentPolicyErrorDetails = async (
  _params: GetProviderContentPolicyErrorParams,
): Promise<ProviderContentPolicyErrorDetails | undefined> => undefined;

export const getProviderContentPolicyErrorMessage = async (
  params: GetProviderContentPolicyErrorParams,
): Promise<string | undefined> => (await getProviderContentPolicyErrorDetails(params))?.message;

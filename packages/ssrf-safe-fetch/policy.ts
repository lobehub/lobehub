import type { RequestFilteringAgentOptions } from 'request-filtering-agent';

/** Shared operator configuration for SSRF-protected request transports. */
export interface SSRFPolicyOptions {
  allowIPAddressList?: string[];
  allowPrivateIPAddress?: boolean;
}

/** Per-call overrides win, including an empty list or an explicit false. */
export const resolveSSRFPolicy = (
  overrides: SSRFPolicyOptions = {},
): RequestFilteringAgentOptions => {
  const allowPrivate =
    overrides.allowPrivateIPAddress ?? process.env.SSRF_ALLOW_PRIVATE_IP_ADDRESS === '1';

  return {
    allowIPAddressList:
      overrides.allowIPAddressList ??
      (process.env.SSRF_ALLOW_IP_ADDRESS_LIST ?? '')
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean),
    allowMetaIPAddress: allowPrivate,
    allowPrivateIPAddress: allowPrivate,
    denyIPAddressList: [],
  };
};

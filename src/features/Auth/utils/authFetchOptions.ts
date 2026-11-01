import { headersToRecord } from '@lobechat/fetch-sse/headers';

import { CAPTCHA_RESPONSE_HEADER } from '@/libs/better-auth/captcha';

export interface AuthFetchOptions {
  headers?: HeadersInit;
  query?: Record<string, unknown>;
}

export const withCaptchaToken = (
  fetchOptions: AuthFetchOptions | undefined,
  captchaToken: string,
) => ({
  ...fetchOptions,
  headers: {
    ...headersToRecord(fetchOptions?.headers),
    [CAPTCHA_RESPONSE_HEADER]: captchaToken,
  },
});

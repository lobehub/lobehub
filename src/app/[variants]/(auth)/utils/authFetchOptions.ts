export const CAPTCHA_RESPONSE_HEADER = 'x-captcha-response';

export interface AuthFetchOptions {
  headers?: HeadersInit;
  query?: Record<string, unknown>;
}

const normalizeHeaders = (headers?: HeadersInit) => {
  if (!headers) return {};
  if (headers instanceof Headers) return Object.fromEntries(headers.entries());
  if (Array.isArray(headers)) return Object.fromEntries(headers);
  return headers;
};

export const withCaptchaToken = (
  fetchOptions: AuthFetchOptions | undefined,
  captchaToken: string,
) => ({
  ...fetchOptions,
  headers: {
    ...normalizeHeaders(fetchOptions?.headers),
    [CAPTCHA_RESPONSE_HEADER]: captchaToken,
  },
});

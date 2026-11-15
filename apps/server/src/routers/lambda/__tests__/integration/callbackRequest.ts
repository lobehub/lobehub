import { signInternalCallback } from '@/libs/qstash/internalSignature';

/** Exercise the real callback authentication with the exact serialized request body. */
export const signedCallbackRequest = (path: string, payload: unknown) => {
  const url = new URL(path, process.env.APP_URL).href;
  const body = JSON.stringify(payload);
  return new Request(url, {
    body,
    headers: { 'content-type': 'application/json', ...signInternalCallback(url, body) },
    method: 'POST',
  });
};

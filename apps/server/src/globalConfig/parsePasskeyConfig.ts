import { appEnv } from '@/envs/app';

/**
 * Whether the deployment has an origin a WebAuthn ceremony could actually use.
 *
 * `appEnv.APP_URL` always resolves — it falls back to `http://localhost:3210`
 * outside Vercel — and it is only validated as a plain string, so it can be
 * malformed or a plain-HTTP public origin. `getPasskeyRpID()` silently gives
 * up when the URL cannot be parsed, so advertising passkeys on those
 * deployments offers a flow that can never succeed.
 */
export const hasUsableAppOrigin = (): boolean => {
  // Vercel derives a real public URL from its own variables; only the implicit
  // localhost fallback means "not configured".
  if (!process.env.APP_URL && process.env.VERCEL !== '1') return false;

  try {
    const { hostname, protocol } = new URL(appEnv.APP_URL);

    // Loopback is a secure context even over plain HTTP. `URL.hostname` keeps
    // the brackets for IPv6, which is also how the repo spells this host in
    // `define-config.ts`.
    const isLoopback = ['localhost', '127.0.0.1', '[::1]'].includes(hostname);

    return protocol === 'https:' || isLoopback;
  } catch {
    return false;
  }
};

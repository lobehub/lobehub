// The route lives under `.well-known`, a dot directory vitest excludes, so its test sits here.
import { describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ ENABLE_OIDC: true }));

vi.mock('@/envs/app', () => ({ appEnv: { APP_URL: 'https://app.lobehub.com' } }));
vi.mock('@/envs/auth', () => ({ authEnv: auth }));

const { GET: getProtectedResourceMetadata } =
  await import('@/app/(backend)/.well-known/oauth-protected-resource/api/v1/route');

describe('GET /.well-known/oauth-protected-resource/api/v1', () => {
  it('describes the /api/v1 resource and its issuer (RFC 9728)', async () => {
    auth.ENABLE_OIDC = true;
    const res = getProtectedResourceMetadata();
    const body = await res.json();

    expect(body.resource).toBe('https://app.lobehub.com/api/v1');
    expect(body.authorization_servers).toEqual(['https://app.lobehub.com/oidc']);
    expect(body.bearer_methods_supported).toEqual(['header']);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('names no authorization server without OIDC', async () => {
    auth.ENABLE_OIDC = false;

    expect(await getProtectedResourceMetadata().json()).not.toHaveProperty('authorization_servers');
  });
});

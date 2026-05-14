import { describe, expect, it } from 'vitest';

import {
  API_PROXY_PATTERN,
  applyDefaultDevTopologyEnv,
  resolveDevTopologyConfig,
} from './devTopology';

type TestEnv = Record<string, string | undefined>;

const createEnv = (env: TestEnv = {}) => ({ ...env });

describe('dev topology strategy', () => {
  it('defaults to the local Next topology with API proxy enabled', () => {
    const config = resolveDevTopologyConfig(createEnv());

    expect(config.topology).toBe('next');
    expect(config.apiRuntime).toBe('next');
    expect(config.honoRuntime).toBe('none');
    expect(config.nextBundler).toBe('turbopack');
    expect(config.appUrl).toBe('http://localhost:3010');
    expect(config.honoTarget).toBeUndefined();
    expect(config.internalAppUrl).toBe('http://localhost:3010');

    expect(config.apiProxy?.[API_PROXY_PATTERN]?.target).toBe('http://localhost:3010');
    expect(new RegExp(API_PROXY_PATTERN).test('/api/version')).toBe(true);
    expect(new RegExp(API_PROXY_PATTERN).test('/trpc/lambda/user.getUserState')).toBe(true);
    expect(new RegExp(API_PROXY_PATTERN).test('/f/file-id')).toBe(true);
    expect(new RegExp(API_PROXY_PATTERN).test('/signin')).toBe(false);
  });

  it('uses the Hono topology as a Next shell with Hono-backed API routes', () => {
    const config = resolveDevTopologyConfig(
      createEnv({ HONO_PORT: '3212', LOBE_DEV_TOPOLOGY: 'hono', PORT: '3211', VITE_PORT: '9888' }),
    );

    expect(config.topology).toBe('hono');
    expect(config.apiRuntime).toBe('next');
    expect(config.honoRuntime).toBe('standalone');
    expect(config.nextBundler).toBe('webpack');
    expect(config.nextRouteRuntime).toBe('hono');
    expect(config.appUrl).toBe('http://localhost:3211');
    expect(config.honoTarget).toBe('http://localhost:3212');
    expect(config.internalAppUrl).toBe('http://localhost:3211');
    expect(config.apiProxy?.[API_PROXY_PATTERN]?.target).toBe('http://localhost:3211');
  });

  it('uses the Hono-lite topology as a Vite shell with direct Hono API proxying', () => {
    const config = resolveDevTopologyConfig(
      createEnv({
        HONO_PORT: '3212',
        LOBE_DEV_TOPOLOGY: 'hono-lite',
        PORT: '3211',
        VITE_PORT: '9888',
      }),
    );

    expect(config.topology).toBe('hono-lite');
    expect(config.apiRuntime).toBe('none');
    expect(config.honoRuntime).toBe('standalone');
    expect(config.nextBundler).toBe('none');
    expect(config.nextRouteRuntime).toBe('none');
    expect(config.appUrl).toBe('http://localhost:9888');
    expect(config.apiTarget).toBe('http://localhost:3212');
    expect(config.honoTarget).toBe('http://localhost:3212');
    expect(config.internalAppUrl).toBe('http://localhost:3212');
    expect(config.apiProxy?.[API_PROXY_PATTERN]?.target).toBe('http://localhost:3212');
  });

  it('keeps Vite-only mode API-free unless an explicit target is configured', () => {
    const localOnly = resolveDevTopologyConfig(createEnv({ LOBE_DEV_TOPOLOGY: 'vite' }));

    expect(localOnly.topology).toBe('vite');
    expect(localOnly.apiRuntime).toBe('none');
    expect(localOnly.honoRuntime).toBe('none');
    expect(localOnly.nextBundler).toBe('none');
    expect(localOnly.apiProxy).toBeUndefined();

    const withTarget = resolveDevTopologyConfig(
      createEnv({
        LOBE_DEV_API_TARGET: 'http://localhost:4321',
        LOBE_DEV_TOPOLOGY: 'vite',
      }),
    );

    expect(withTarget.apiProxy?.[API_PROXY_PATTERN]?.target).toBe('http://localhost:4321');
  });

  it('applies Vite-only public URL defaults without enabling proxy implicitly', () => {
    const env = createEnv({ APP_URL: 'http://localhost:3010', LOBE_DEV_TOPOLOGY: 'vite' });
    const config = applyDefaultDevTopologyEnv(env);

    expect(config.apiProxy).toBeUndefined();
    expect(env.APP_URL).toBe('http://localhost:9876');
    expect(env.LOBE_DEV_API_TARGET).toBeUndefined();
  });

  it('keeps auth and OIDC routes on native Next in the local Hono topology', () => {
    const honoEnv = createEnv({ LOBE_API_RUNTIME: 'hono', LOBE_DEV_TOPOLOGY: 'hono' });
    applyDefaultDevTopologyEnv(honoEnv);

    expect(honoEnv.LOBE_API_RUNTIME).toBe('hono');
    expect(honoEnv.LOBE_API_AUTH_RUNTIME).toBe('next');
    expect(honoEnv.LOBE_API_AUTH_CHECK_USER_RUNTIME).toBe('next');
    expect(honoEnv.LOBE_API_AUTH_RESOLVE_USERNAME_RUNTIME).toBe('next');
    expect(honoEnv.LOBE_OIDC_CALLBACK_DESKTOP_RUNTIME).toBe('next');
    expect(honoEnv.LOBE_OIDC_CLEAR_SESSION_RUNTIME).toBe('next');
    expect(honoEnv.LOBE_OIDC_CONSENT_RUNTIME).toBe('next');
    expect(honoEnv.LOBE_OIDC_HANDOFF_RUNTIME).toBe('next');
    expect(honoEnv.LOBE_OIDC_PROVIDER_RUNTIME).toBe('next');
    expect(honoEnv.LOBE_API_VERSION_RUNTIME).toBeUndefined();
    expect(honoEnv.LOBE_TRPC_RUNTIME).toBeUndefined();
    expect(honoEnv.LOBE_DEV_HONO_TARGET).toBe('http://localhost:3011');
    expect(honoEnv.LOBE_DEV_AUTH_BOOTSTRAP).toBeUndefined();

    const honoLiteEnv = createEnv({ LOBE_DEV_TOPOLOGY: 'hono-lite' });
    applyDefaultDevTopologyEnv(honoLiteEnv);

    expect(honoLiteEnv.APP_URL).toBe('http://localhost:9876');
    expect(honoLiteEnv.INTERNAL_APP_URL).toBe('http://localhost:3011');
    expect(honoLiteEnv.LOBE_DEV_API_TARGET).toBe('http://localhost:3011');
    expect(honoLiteEnv.LOBE_DEV_AUTH_BOOTSTRAP).toBe('1');

    const nextEnv = createEnv({ LOBE_DEV_TOPOLOGY: 'next' });
    applyDefaultDevTopologyEnv(nextEnv);

    expect(nextEnv.LOBE_API_RUNTIME).toBeUndefined();
    expect(nextEnv.LOBE_TRPC_RUNTIME).toBeUndefined();
  });

  it('uses explicit dev URL overrides instead of legacy APP_URL values', () => {
    const config = resolveDevTopologyConfig(
      createEnv({
        APP_URL: 'http://localhost:3010',
        INTERNAL_APP_URL: 'http://localhost:3010',
        LOBE_DEV_APP_URL: 'http://local.lobehub.test:9876',
        LOBE_DEV_INTERNAL_APP_URL: 'http://local-api.lobehub.test:3010',
        LOBE_DEV_TOPOLOGY: 'hono',
      }),
    );

    expect(config.appUrl).toBe('http://local.lobehub.test:9876');
    expect(config.internalAppUrl).toBe('http://local-api.lobehub.test:3010');
  });
});

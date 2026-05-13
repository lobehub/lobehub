export type DevTopology = 'hono' | 'next' | 'vite';

type Env = Record<string, string | undefined>;

interface DevTopologyStrategy {
  apiRuntime: 'next' | 'none';
  defaultAppUrl: (env: Env) => string;
  defaultHonoTarget?: (env: Env) => string;
  defaultInternalAppUrl?: (env: Env) => string;
  honoRuntime: 'standalone' | 'none';
  nativeNextRuntimeEnv?: readonly string[];
  nextBundler: 'turbopack' | 'webpack' | 'none';
  nextRouteRuntime: 'hono' | 'next' | 'none';
  shouldProxyAPI: (env: Env) => boolean;
  topology: DevTopology;
}

interface DevTopologyConfig {
  apiProxy: Record<string, { changeOrigin: true; target: string; ws: true }> | undefined;
  apiRuntime: DevTopologyStrategy['apiRuntime'];
  apiTarget: string;
  appUrl: string;
  honoRuntime: DevTopologyStrategy['honoRuntime'];
  honoTarget: string | undefined;
  internalAppUrl: string | undefined;
  nextBundler: DevTopologyStrategy['nextBundler'];
  nextRouteRuntime: DevTopologyStrategy['nextRouteRuntime'];
  topology: DevTopology;
}

const DEFAULT_API_HOST = 'localhost';
const DEFAULT_API_PORT = 3010;
const DEFAULT_HONO_HOST = 'localhost';
const DEFAULT_HONO_PORT = 3011;
const DEFAULT_VITE_HOST = 'localhost';
const DEFAULT_VITE_PORT = 9876;

export const API_PROXY_PREFIXES = ['/api', '/oidc', '/trpc', '/webapi', '/market', '/f'] as const;

const AUTH_NATIVE_NEXT_RUNTIME_ENV = [
  'LOBE_API_AUTH_RUNTIME',
  'LOBE_API_AUTH_CHECK_USER_RUNTIME',
  'LOBE_API_AUTH_RESOLVE_USERNAME_RUNTIME',
  'LOBE_OIDC_CALLBACK_DESKTOP_RUNTIME',
  'LOBE_OIDC_CLEAR_SESSION_RUNTIME',
  'LOBE_OIDC_CONSENT_RUNTIME',
  'LOBE_OIDC_HANDOFF_RUNTIME',
  'LOBE_OIDC_PROVIDER_RUNTIME',
] as const;

const createLocalUrl = (host: string, port: number) => `http://${host}:${port}`;

export const resolveDevAPIPort = (env: Env = process.env): number => {
  const parsed = Number.parseInt(env.PORT ?? '', 10);

  return Number.isNaN(parsed) ? DEFAULT_API_PORT : parsed;
};

export const resolveVitePort = (env: Env = process.env): number => {
  const parsed = Number.parseInt(env.VITE_PORT ?? '', 10);

  return Number.isNaN(parsed) ? DEFAULT_VITE_PORT : parsed;
};

export const resolveDevHonoPort = (env: Env = process.env): number => {
  const parsed = Number.parseInt(env.HONO_PORT ?? '', 10);

  return Number.isNaN(parsed) ? DEFAULT_HONO_PORT : parsed;
};

const resolveDefaultAPITarget = (env: Env) =>
  createLocalUrl(DEFAULT_API_HOST, resolveDevAPIPort(env));

const resolveDefaultViteOrigin = (env: Env) =>
  createLocalUrl(DEFAULT_VITE_HOST, resolveVitePort(env));

const resolveDefaultHonoTarget = (env: Env) =>
  createLocalUrl(DEFAULT_HONO_HOST, resolveDevHonoPort(env));

const devTopologyStrategies: Record<DevTopology, DevTopologyStrategy> = {
  hono: {
    apiRuntime: 'next',
    defaultAppUrl: resolveDefaultAPITarget,
    defaultHonoTarget: resolveDefaultHonoTarget,
    defaultInternalAppUrl: resolveDefaultAPITarget,
    honoRuntime: 'standalone',
    nativeNextRuntimeEnv: AUTH_NATIVE_NEXT_RUNTIME_ENV,
    nextBundler: 'webpack',
    nextRouteRuntime: 'hono',
    shouldProxyAPI: () => true,
    topology: 'hono',
  },
  next: {
    apiRuntime: 'next',
    defaultAppUrl: resolveDefaultAPITarget,
    defaultInternalAppUrl: resolveDefaultAPITarget,
    honoRuntime: 'none',
    nextBundler: 'turbopack',
    nextRouteRuntime: 'next',
    shouldProxyAPI: () => true,
    topology: 'next',
  },
  vite: {
    apiRuntime: 'none',
    defaultAppUrl: resolveDefaultViteOrigin,
    honoRuntime: 'none',
    nextBundler: 'none',
    nextRouteRuntime: 'none',
    shouldProxyAPI: (env) => Boolean(env.LOBE_DEV_API_TARGET),
    topology: 'vite',
  },
};

export const normalizeDevTopology = (value: string | undefined): DevTopology => {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'hono' || normalized === 'next' || normalized === 'vite') return normalized;

  return 'next';
};

export const resolveDevTopologyConfig = (env: Env = process.env): DevTopologyConfig => {
  const topology = normalizeDevTopology(env.LOBE_DEV_TOPOLOGY);
  const strategy = devTopologyStrategies[topology];
  const apiTarget = env.LOBE_DEV_API_TARGET || resolveDefaultAPITarget(env);
  const appUrl = env.LOBE_DEV_APP_URL || strategy.defaultAppUrl(env);
  const honoTarget = env.LOBE_DEV_HONO_TARGET || strategy.defaultHonoTarget?.(env);
  const internalAppUrl =
    env.LOBE_DEV_INTERNAL_APP_URL || strategy.defaultInternalAppUrl?.(env) || undefined;
  const shouldProxyAPI = strategy.shouldProxyAPI(env);

  return {
    apiProxy: shouldProxyAPI
      ? Object.fromEntries(
          API_PROXY_PREFIXES.map((prefix) => [
            prefix,
            {
              changeOrigin: true,
              target: apiTarget,
              ws: true,
            },
          ]),
        )
      : undefined,
    apiRuntime: strategy.apiRuntime,
    apiTarget,
    appUrl,
    honoRuntime: strategy.honoRuntime,
    honoTarget,
    internalAppUrl,
    nextBundler: strategy.nextBundler,
    nextRouteRuntime: strategy.nextRouteRuntime,
    topology,
  };
};

export const applyDefaultDevTopologyEnv = (env: Env = process.env) => {
  const config = resolveDevTopologyConfig(env);

  env.LOBE_DEV_TOPOLOGY = config.topology;
  env.APP_URL = config.appUrl;
  if (config.internalAppUrl) env.INTERNAL_APP_URL = config.internalAppUrl;
  if (config.apiRuntime !== 'none' || env.LOBE_DEV_API_TARGET) {
    env.LOBE_DEV_API_TARGET ||= config.apiTarget;
  }
  if (config.honoTarget) env.LOBE_DEV_HONO_TARGET ||= config.honoTarget;

  const strategy = devTopologyStrategies[config.topology];
  for (const envName of strategy.nativeNextRuntimeEnv ?? []) {
    env[envName] = 'next';
  }

  return config;
};

export default {
  applyDefaultDevTopologyEnv,
  resolveDevAPIPort,
  resolveDevHonoPort,
};

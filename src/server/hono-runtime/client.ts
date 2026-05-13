import path from 'node:path';

interface HonoFetchApp {
  fetch: (request: Request) => Promise<Response> | Response;
}

interface HonoDistModule {
  default?: unknown;
}

let productionHonoApp: HonoFetchApp | undefined;

const isHonoFetchApp = (value: unknown): value is HonoFetchApp =>
  typeof value === 'object' &&
  value !== null &&
  'fetch' in value &&
  typeof value.fetch === 'function';

const createForwardRequest = (request: Request, url: URL) => {
  const headers = new Headers(request.headers);
  headers.delete('host');

  const init: RequestInit & { duplex?: 'half' } = {
    headers,
    method: request.method,
    redirect: request.redirect,
    signal: request.signal,
  };

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = request.body;
    init.duplex = 'half';
  }

  return new Request(url, init);
};

interface ModuleLoader {
  createRequire?: (filename: string) => (id: string) => unknown;
}

interface ProcessWithBuiltinModule {
  getBuiltinModule?: (id: string) => unknown;
}

const loadExternalModule = (entry: string) => {
  const moduleLoader = (process as ProcessWithBuiltinModule).getBuiltinModule?.('node:module') as
    | ModuleLoader
    | undefined;
  const runtimeRequire = moduleLoader?.createRequire?.(path.join(process.cwd(), 'package.json'));

  if (!runtimeRequire) {
    throw new TypeError('Runtime require is not available for the Hono dist entry');
  }

  return runtimeRequire(entry);
};

const loadProductionHonoApp = () => {
  if (productionHonoApp) return productionHonoApp;

  const entry = process.env.LOBE_HONO_DIST_ENTRY || path.join(process.cwd(), 'hono/dist/index.js');
  const module = loadExternalModule(entry) as HonoDistModule | HonoFetchApp;
  const app = isHonoFetchApp(module)
    ? module
    : isHonoFetchApp(module.default)
      ? module.default
      : undefined;

  if (!app) {
    throw new TypeError(`Hono dist entry does not export a fetch-compatible app: ${entry}`);
  }

  productionHonoApp = app;

  return app;
};

export const fetchHonoRuntime = async (request: Request) => {
  const devTarget = process.env.LOBE_DEV_HONO_TARGET;

  if (process.env.NODE_ENV !== 'production' && devTarget) {
    const sourceUrl = new URL(request.url);
    const targetUrl = new URL(devTarget);
    targetUrl.pathname = sourceUrl.pathname;
    targetUrl.search = sourceUrl.search;

    return fetch(createForwardRequest(request, targetUrl));
  }

  return loadProductionHonoApp().fetch(request);
};

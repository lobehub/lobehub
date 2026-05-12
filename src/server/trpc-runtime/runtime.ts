export type TRPCRouteId = 'async' | 'lambda' | 'mobile' | 'tools';
export type TRPCRuntime = 'hono' | 'next';

type TRPCRuntimeMode = TRPCRuntime | 'gray';

interface RuntimeSelection {
  percent: number;
  reason: string;
  runtime: TRPCRuntime;
}

const DEFAULT_GRAY_PERCENT = 0;
const MAX_PERCENT = 100;
const MIN_PERCENT = 0;

const TRPC_RUNTIME_HEADER = 'x-lobe-trpc-runtime';
const TRPC_RUNTIME_REASON_HEADER = 'x-lobe-trpc-runtime-reason';

const ROUTE_RUNTIME_ENV = {
  async: 'LOBE_TRPC_ASYNC_RUNTIME',
  lambda: 'LOBE_TRPC_LAMBDA_RUNTIME',
  mobile: 'LOBE_TRPC_MOBILE_RUNTIME',
  tools: 'LOBE_TRPC_TOOLS_RUNTIME',
} as const satisfies Record<TRPCRouteId, string>;

const ROUTE_PERCENT_ENV = {
  async: 'LOBE_TRPC_ASYNC_HONO_PERCENT',
  lambda: 'LOBE_TRPC_LAMBDA_HONO_PERCENT',
  mobile: 'LOBE_TRPC_MOBILE_HONO_PERCENT',
  tools: 'LOBE_TRPC_TOOLS_HONO_PERCENT',
} as const satisfies Record<TRPCRouteId, string>;

const normalizeRuntime = (value: string | null | undefined): TRPCRuntimeMode | undefined => {
  const normalized = value?.trim().toLowerCase();

  if (normalized === 'hono' || normalized === 'next' || normalized === 'gray') return normalized;

  return undefined;
};

const readRuntimeMode = (route: TRPCRouteId): TRPCRuntimeMode | undefined =>
  normalizeRuntime(process.env[ROUTE_RUNTIME_ENV[route]]) ??
  normalizeRuntime(process.env.LOBE_TRPC_RUNTIME);

const readGrayPercent = (route: TRPCRouteId): number => {
  const rawValue = process.env[ROUTE_PERCENT_ENV[route]] ?? process.env.LOBE_TRPC_HONO_PERCENT;
  if (!rawValue) return DEFAULT_GRAY_PERCENT;

  const parsedValue = Number.parseInt(rawValue, 10);
  if (Number.isNaN(parsedValue)) return DEFAULT_GRAY_PERCENT;

  return Math.min(MAX_PERCENT, Math.max(MIN_PERCENT, parsedValue));
};

const hashToBucket = (value: string): number => {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0) % MAX_PERCENT;
};

const createStableGrayKey = (request: Request, route: TRPCRouteId): string => {
  const url = new URL(request.url);

  return [
    route,
    url.pathname,
    request.headers.get('cookie') ?? '',
    request.headers.get('authorization') ?? '',
    request.headers.get('x-api-key') ?? '',
    request.headers.get('x-forwarded-for') ?? '',
    request.headers.get('user-agent') ?? '',
  ].join('|');
};

export const selectTRPCRuntime = (request: Request, route: TRPCRouteId): RuntimeSelection => {
  const requestedRuntime = normalizeRuntime(request.headers.get(TRPC_RUNTIME_HEADER));
  if (requestedRuntime === 'hono' || requestedRuntime === 'next') {
    return {
      percent: requestedRuntime === 'hono' ? MAX_PERCENT : MIN_PERCENT,
      reason: 'request-header',
      runtime: requestedRuntime,
    };
  }

  const configuredMode = readRuntimeMode(route);
  if (configuredMode === 'hono' || configuredMode === 'next') {
    return {
      percent: configuredMode === 'hono' ? MAX_PERCENT : MIN_PERCENT,
      reason: `${ROUTE_RUNTIME_ENV[route]}/LOBE_TRPC_RUNTIME`,
      runtime: configuredMode,
    };
  }

  const percent = readGrayPercent(route);
  if (configuredMode !== 'gray' && percent <= MIN_PERCENT) {
    return { percent, reason: 'default', runtime: 'next' };
  }

  const bucket = hashToBucket(createStableGrayKey(request, route));

  return {
    percent,
    reason: configuredMode === 'gray' ? 'gray-runtime-env' : 'gray-percent-env',
    runtime: bucket < percent ? 'hono' : 'next',
  };
};

export const withTRPCRuntimeHeaders = (
  response: Response,
  selection: RuntimeSelection,
): Response => {
  const headers = new Headers(response.headers);

  headers.set(TRPC_RUNTIME_HEADER, selection.runtime);
  headers.set(TRPC_RUNTIME_REASON_HEADER, selection.reason);

  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
};

import { type RouteAttemptMetadata } from './attemptIdentity';
import type { RouteAttemptContext, RouterRuntimeDeps } from './routeSelection';

interface RouteAttemptContextValidationParams extends RouteAttemptContext {
  apiType: string;
  channelId?: string;
  model: string;
  routerId?: string;
}

export const attachRouteAttemptMetadata = (
  deps: RouterRuntimeDeps,
  metadata: Record<string, unknown> | undefined,
  routeAttempt: RouteAttemptMetadata,
) => {
  if (!metadata || deps.id !== 'lobehub') return;

  metadata.routeAttempt = routeAttempt;
};

export const validateRouteAttemptContext = (
  deps: RouterRuntimeDeps,
  {
    apiType,
    channelId,
    metadata,
    model,
    routerId,
    toolsCount,
    user,
  }: RouteAttemptContextValidationParams,
) => {
  const runtimeUserId = typeof deps.options.userId === 'string' ? deps.options.userId : undefined;
  const effectiveUserId = runtimeUserId || user;
  const trigger = metadata?.trigger;
  const traceId = typeof metadata?.traceId === 'string' ? metadata.traceId : undefined;

  /** Pre-auth flows have no user id yet, so their stable trace id identifies the request. */
  if (deps.id !== 'lobehub' || ((effectiveUserId || traceId) && trigger)) {
    return effectiveUserId;
  }
  if (process.env.NODE_ENV !== 'development') return effectiveUserId;

  const diagnostic = {
    apiType,
    channelId,
    metadataKeys: Object.keys(metadata ?? {}),
    missingTrigger: !trigger,
    missingUser: !effectiveUserId,
    model,
    optionUserPresent: Boolean(user),
    providerId: deps.id,
    routerId,
    runtimeUserIdPresent: Boolean(runtimeUserId),
    stack: new Error('RouteAttemptMissingContext').stack?.split('\n').slice(0, 20),
    toolsCount: toolsCount ?? 0,
    traceId,
    trigger,
  };

  // Example bug: modelRuntime.chat(payload) without metadata would record trigger=null.
  throw new Error(`[RouteAttemptMissingContext] ${JSON.stringify(diagnostic)}`);
};

import { ensureProjectionView } from './client';
import type { ProjectionViewContract } from './types';

/** A View Contract bound to its params, erased so callers can queue mixed kinds. */
export interface ProjectionPrefetch {
  key: string;
  run: (scope: string) => Promise<void>;
}

export const projectionPrefetch = <Params>(
  contract: ProjectionViewContract<Params>,
  params: Params,
): ProjectionPrefetch => ({
  key: contract.key(params),
  run: (scope) => ensureProjectionView(scope, contract, params),
});

/**
 * Run one tier. Requests inside a tier are concurrent — they are all first-screen
 * data and the local reads are sub-millisecond — while tiers stay sequential:
 * the desktop main process is the real bottleneck, so a lower-priority tier
 * flooding it would delay the surface the user is actually looking at.
 */
export const runProjectionPrefetch = async (
  scope: string,
  requests: ProjectionPrefetch[],
): Promise<void> => {
  const seen = new Set<string>();
  await Promise.all(
    requests.flatMap((request) => {
      if (seen.has(request.key)) return [];
      seen.add(request.key);
      return [request.run(scope).catch(() => {})];
    }),
  );
};

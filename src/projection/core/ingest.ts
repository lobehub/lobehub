import type { ProjectionFragment, ProjectionSource } from '@lobechat/types';

export interface ProjectionObservation {
  observedAt: number;
  source: ProjectionSource;
}

let lastObservedAt = 0;

/**
 * Wall-clock observation marker with a process-local monotonic tie breaker.
 * Multiple writes can occur in one millisecond; preserving their actual start
 * order prevents an equal-timestamp source priority from rejecting a later
 * rollback fetch or accepting an older response.
 */
export const nextProjectionObservedAt = (): number => {
  lastObservedAt = Math.max(Date.now(), lastObservedAt + 1);
  return lastObservedAt;
};

export const projectionObservation = (
  source: ProjectionSource = 'network',
  observedAt: number = nextProjectionObservedAt(),
): ProjectionObservation => ({ observedAt, source });

export const projectionFragment = <T>(
  data: T,
  observation: ProjectionObservation,
): ProjectionFragment<T> => ({ data, ...observation });

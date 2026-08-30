/** Source of an accepted client projection change. */
export type ProjectionSource = 'mutation' | 'network' | 'realtime';

/**
 * A replace-only field group. `observedAt` describes when the source operation
 * started, so a slow older request cannot overwrite a newer mutation.
 */
export interface ProjectionFragment<T> {
  data: T;
  observedAt: number;
  source: ProjectionSource;
}

export type ProjectionFragmentSet<T extends object> = Partial<{
  [K in keyof T]: ProjectionFragment<T[K]>;
}>;

/** The sole mutable partial projection for one `(scope, kind, id)` identity. */
export interface ProjectionRecordBase<K extends string, F extends object> {
  fragments: ProjectionFragmentSet<F>;
  id: string;
  kind: K;
  /** Prevents responses observed before a delete from reviving the projection. */
  tombstoneAt?: number;
}

export interface ProjectionRef<K extends string = string> {
  id: string;
  kind: K;
}

export interface ProjectionTombstone<K extends string = string> extends ProjectionRef<K> {
  observedAt: number;
}

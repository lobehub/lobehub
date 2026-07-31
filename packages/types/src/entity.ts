/** Source of an accepted client entity change. */
export type EntitySource = 'mutation' | 'network' | 'realtime';

/**
 * A replace-only field group. `observedAt` describes when the source operation
 * started, so a slow older request cannot overwrite a newer mutation.
 */
export interface EntityFragment<T> {
  data: T;
  observedAt: number;
  source: EntitySource;
}

export type EntityFragmentSet<T extends object> = Partial<{
  [K in keyof T]: EntityFragment<T[K]>;
}>;

/** The sole mutable record for one `(scope, kind, id)` identity. */
export interface EntityRecord<K extends string, F extends object> {
  fragments: EntityFragmentSet<F>;
  id: string;
  kind: K;
  /** Prevents responses observed before a delete from reviving the entity. */
  tombstoneAt?: number;
}

export interface EntityRef<K extends string = string> {
  id: string;
  kind: K;
}

export interface EntityTombstone<K extends string = string> extends EntityRef<K> {
  observedAt: number;
}

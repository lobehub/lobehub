export type KeyFactory<A extends unknown[]> = ((...args: A) => readonly unknown[]) & {
  root: string;
};

/** Define a key factory carrying its namespace root (for `mutate` matchers). */
export const def = <A extends unknown[]>(
  root: string,
  build: (...args: A) => readonly unknown[],
): KeyFactory<A> => Object.assign(build, { root });

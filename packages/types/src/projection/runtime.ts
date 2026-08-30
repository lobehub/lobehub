export interface ProjectionKeyPattern<Prefix extends string = string> {
  allowEmptySuffix?: boolean;
  prefix: Prefix;
}

type ProjectionPatternKey<Pattern extends ProjectionKeyPattern> =
  Pattern extends ProjectionKeyPattern<infer Prefix> ? `${Prefix}${string}` : never;

export interface ProjectionKeySpace<
  StaticKeys extends readonly string[],
  Patterns extends readonly ProjectionKeyPattern[],
> {
  isKey: (value: unknown) => value is StaticKeys[number] | ProjectionPatternKey<Patterns[number]>;
  patterns: Patterns;
  staticKeys: StaticKeys;
}

export type ProjectionKeyOf<
  Space extends ProjectionKeySpace<readonly string[], readonly ProjectionKeyPattern[]>,
> =
  Space extends ProjectionKeySpace<infer StaticKeys, infer Patterns>
    ? StaticKeys[number] | ProjectionPatternKey<Patterns[number]>
    : never;

export const defineProjectionKeySpace = <
  const StaticKeys extends readonly string[],
  const Patterns extends readonly ProjectionKeyPattern[],
>({
  patterns,
  staticKeys,
}: {
  patterns: Patterns;
  staticKeys: StaticKeys;
}): ProjectionKeySpace<StaticKeys, Patterns> => {
  const staticKeySet = new Set<string>(staticKeys);
  const isKey = (
    value: unknown,
  ): value is StaticKeys[number] | ProjectionPatternKey<Patterns[number]> => {
    if (typeof value !== 'string') return false;
    if (staticKeySet.has(value)) return true;

    return patterns.some(
      ({ allowEmptySuffix = false, prefix }) =>
        value.startsWith(prefix) && (allowEmptySuffix || value.length > prefix.length),
    );
  };

  return { isKey, patterns, staticKeys };
};

export const defineProjectionFragmentNames =
  <FragmentMap>() =>
  <const Names extends readonly Extract<keyof FragmentMap, string>[]>(
    names: Exclude<Extract<keyof FragmentMap, string>, Names[number]> extends never ? Names : never,
  ): Names =>
    names;

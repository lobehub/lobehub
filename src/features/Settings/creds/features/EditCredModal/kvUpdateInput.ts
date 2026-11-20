interface KVFormValues {
  description?: string;
  kvPairs?: Array<{ key: string; value: string }>;
  name: string;
}

/**
 * The `update` request for a key-value credential edited in the form.
 *
 * Pairs missing a key or a value are dropped. For a write-only credential the
 * form starts empty, so entering no pair means "keep the stored values": the
 * request then carries no `values` at all, since an empty object would wipe
 * them. Entering any pair replaces the whole set.
 */
export const buildKVUpdateInput = (id: number, values: KVFormValues, writeOnly?: boolean) => {
  const pairs = Object.fromEntries(
    (values.kvPairs ?? [])
      .filter((pair) => pair.key && pair.value)
      .map((pair) => [pair.key, pair.value]),
  );
  const keepValues = writeOnly && Object.keys(pairs).length === 0;

  return {
    description: values.description,
    id,
    name: values.name,
    ...(keepValues ? {} : { values: pairs }),
  };
};

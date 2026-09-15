/**
 * Apply a partial update to a JSON column without discarding the keys the
 * request could not express.
 *
 * The public API schemas expose a *slice* of these columns — `agencyConfig`
 * only carries the graph settings, for example — while the stored object also
 * holds permission policies, device bindings and execution settings written by
 * other surfaces. Assigning the request payload straight onto the column would
 * therefore delete every field the caller never mentioned, which for
 * `agencyConfig` means silently reopening a restricted agent's topic sharing.
 *
 * `undefined` removes a key (the only way a caller can drop one); a `null`
 * *value* is kept, because the schemas use it as an explicit "cleared" field.
 *
 * A `null` *patch* is a no-op here. Whether a whole-column `null` clears the
 * column is the caller's decision, not this helper's — `agencyConfig` and
 * `chatConfig` clear on it, `params` never did.
 */
export const mergeJsonPatch = (
  existing: unknown,
  // `object`, not `Record<string, unknown>`: the callers pass interface-typed
  // payloads (`LobeAgentChatConfig`), and a bare interface carries no implicit
  // index signature, so it would not be assignable.
  patch: object | null | undefined,
): Record<string, unknown> => {
  const merged = { ...(existing as Record<string, unknown>) };

  for (const [key, value] of Object.entries(patch ?? {})) {
    if (value === undefined) {
      delete merged[key];
    } else {
      merged[key] = value;
    }
  }

  return merged;
};

/**
 * Weak models sometimes send `setTaskVerify` booleans and numbers as JSON
 * strings (`"true"`, `"3"`) — the manifest types them as `boolean | null` /
 * `integer | null` unions, which some models flatten to strings. Passed
 * through, the TRPC schema rejects the whole call with "expected boolean,
 * received string". Coerce the unambiguous literals; leave anything else for
 * the schema to report.
 */
export const normalizeSetTaskVerifyParams = <T extends object>(params: T): T => {
  const normalized = { ...params } as Record<string, unknown>;
  // Some models double-encode: `"\"true\""`.
  const literal = (value: string) =>
    value
      .trim()
      .replace(/^"(.*)"$/, '$1')
      .trim();

  if (typeof normalized.enabled === 'string') {
    const value = literal(normalized.enabled).toLowerCase();
    if (value === 'true') normalized.enabled = true;
    else if (value === 'false') normalized.enabled = false;
    else if (value === 'null') normalized.enabled = null;
  }

  if (typeof normalized.maxIterations === 'string') {
    const value = literal(normalized.maxIterations);
    if (value === 'null') normalized.maxIterations = null;
    else if (/^\d+$/.test(value)) normalized.maxIterations = Number(value);
  }

  return normalized as T;
};

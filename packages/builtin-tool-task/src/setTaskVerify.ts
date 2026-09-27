/**
 * Weak models sometimes send `setTaskVerify` booleans and numbers as JSON
 * strings (`"true"`, `"3"`) — the manifest types them as `boolean | null` /
 * `integer | null` unions, which some models flatten to strings. Passed
 * through, the TRPC schema rejects the whole call with "expected boolean,
 * received string". Coerce the unambiguous literals; leave anything else for
 * the schema to report.
 */
export const normalizeSetTaskVerifyParams = <
  T extends { enabled?: unknown; maxIterations?: unknown },
>(
  params: T,
): T => {
  const normalized = { ...params };

  if (typeof params.enabled === 'string') {
    const value = params.enabled.trim().toLowerCase();
    if (value === 'true') normalized.enabled = true;
    else if (value === 'false') normalized.enabled = false;
    else if (value === 'null' || value === '') normalized.enabled = null;
  }

  if (typeof params.maxIterations === 'string') {
    const value = params.maxIterations.trim();
    if (value === 'null' || value === '') normalized.maxIterations = null;
    else if (/^\d+$/.test(value)) normalized.maxIterations = Number(value);
  }

  return normalized;
};

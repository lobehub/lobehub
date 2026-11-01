/**
 * Visitor IP recorded on request-scoped server state such as tRPC `ctx.clientIp`.
 *
 * Reads only the headers a reverse proxy sets or overwrites (`x-forwarded-for`, then
 * `x-real-ip`), never client-suppliable ones like `cf-connecting-ip`: behind Nginx or any
 * non-Cloudflare proxy a caller could otherwise pick the IP that lands in audit records.
 *
 * Callers import it as `@/utils/requestClientIP` so a deployment behind a gateway it can
 * verify may override this one module instead of patching every caller.
 */
export const getRequestClientIP = (headers: Headers): string | undefined => {
  const forwardedFor = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (forwardedFor) return forwardedFor;

  return headers.get('x-real-ip')?.trim() || undefined;
};

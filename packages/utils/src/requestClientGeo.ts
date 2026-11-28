/**
 * Where a request came from, as located by an edge the server trusts. Approximate: it comes from
 * the visitor IP, not the device.
 */
export interface RequestClientGeo {
  /** City name, e.g. `Tokyo`. */
  city?: string;
  /** ISO 3166-1 alpha-2 country code, e.g. `JP`. */
  country: string;
  /** ISO 3166-2 subdivision code, e.g. `JP-13`. */
  region?: string;
}

/**
 * Location recorded on request-scoped server state such as tRPC `ctx.clientGeo`.
 *
 * Returns `undefined`: a plain reverse proxy gives the server no location it can verify, and a
 * location header a caller can set is not evidence. Callers import it as
 * `@/utils/requestClientGeo` so a deployment behind an edge it can verify may override this one
 * module.
 */
export const getRequestClientGeo = (_headers: Headers): RequestClientGeo | undefined => undefined;

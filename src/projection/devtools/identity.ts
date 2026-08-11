/** Stable diagnostic identity for keyed rows in Projection DevTools. */
export const projectionDevtoolRecordKey = (scope: string, kind: string, id: string): string =>
  `${encodeURIComponent(scope)}::${encodeURIComponent(kind)}::${encodeURIComponent(id)}`;

/**
 * `location.pathname` is percent-encoded per the URL spec, so a readable slug
 * (`/task/T-1/飞书适配器支持-post-图文消息`) reads back as `%E9%A3%9E%E4%B9%A6…`
 * and the dock stops telling you which route you are on.
 *
 * `decodeURI` (not `decodeURIComponent`) keeps reserved delimiters escaped, so
 * an encoded `%2F` inside a segment can't silently turn into a path separator
 * and misreport the route. A malformed sequence falls back to the raw path
 * rather than throwing and taking the dock down with it.
 */
export const readableRoutePath = (path: string): string => {
  try {
    return decodeURI(path);
  } catch {
    return path;
  }
};

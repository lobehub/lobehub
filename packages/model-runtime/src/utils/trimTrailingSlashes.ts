/**
 * Remove trailing `/` characters from a URL without a regular expression, so untrusted
 * base URLs cannot trigger polynomial backtracking.
 */
export const trimTrailingSlashes = (url: string) => {
  let end = url.length;
  while (end > 0 && url[end - 1] === '/') end--;
  return url.slice(0, end);
};

/**
 * Sanitize UTF-8 string to remove all control characters and invalid code points.
 * @param str
 */
export const sanitizeUTF8 = (str: string) => {
  // Remove replacement character (0xFFFD) and other illegal characters
  return (
    str
      .replaceAll('�', '') // Remove Unicode replacement character
      // eslint-disable-next-line no-control-regex
      .replaceAll(/[\u0000-\u0008\v\f\u000E-\u001F\u007F-\u009F]/g, '') // Remove control characters
      // The `u` flag makes valid surrogate PAIRS match as a single code point
      // outside this range, so emoji / astral-plane characters are preserved;
      // only truly unpaired (lone) surrogates are removed.
      .replaceAll(/[\uD800-\uDFFF]/gu, '')
  );
};

const MARKUP_TAG_PATTERN = /<(\/?)([a-z][\w.:-]*)(?:\s[^<>]*|\/)?>/gi;

// `<` followed by a letter or `/` opens a tag for the XML parser; a raw `<`
// before a digit, space or another `<` is accepted as text.
const TAG_START_PATTERN = /<\/?[a-z]/gi;
const COMPLETE_TAG_PATTERN = /<\/?[a-z][\w.:-]*(?:\s[^<>]*|\/)?>/iy;

const describeMalformedMarkup = (litexml: string): string | undefined => {
  for (const { index } of litexml.matchAll(TAG_START_PATTERN)) {
    COMPLETE_TAG_PATTERN.lastIndex = index;
    if (!COMPLETE_TAG_PATTERN.test(litexml)) {
      const fragment = litexml
        .slice(index)
        .match(/^<[^<]{0,24}/)![0]
        .trimEnd();
      return `"${fragment}" starts a tag that is never closed with ">"`;
    }
  }

  const open: string[] = [];

  for (const [tag, closing, name] of litexml.matchAll(MARKUP_TAG_PATTERN)) {
    if (tag.endsWith('/>')) continue;
    if (!closing) {
      open.push(name);
      continue;
    }

    const at = open.lastIndexOf(name);
    if (at === -1) return `</${name}> has no matching opening tag`;
    if (at !== open.length - 1) return `<${open.at(-1)}> is never closed`;
    open.pop();
  }

  return open.length > 0 ? `<${open.at(-1)}> is never closed` : undefined;
};

/**
 * The editor parses LiteXML as XML and silently drops an operation whose
 * fragment is not well-formed — most often text that contains a raw `<`, such
 * as `-m <model>` or `List<string>`. Explain that instead of reporting a
 * rejection the caller cannot act on.
 */
export const findMalformedLiteXML = (litexml: string | string[]): string | undefined => {
  for (const fragment of Array.isArray(litexml) ? litexml : [litexml]) {
    const problem = describeMalformedMarkup(fragment);
    if (problem) {
      return `litexml is not well-formed XML (${problem}). Text cannot contain a raw "<": write a literal "<" as "&lt;" and "&" as "&amp;" (e.g. "&lt;model&gt;")`;
    }
  }
};

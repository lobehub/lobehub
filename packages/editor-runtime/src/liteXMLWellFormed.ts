const MARKUP_TAG_PATTERN = /<(\/?)([a-z][\w.:-]*)(?:\s[^<>]*|\/)?>/gi;

const describeMalformedMarkup = (litexml: string): string | undefined => {
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

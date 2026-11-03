// Skip code spans and fenced code blocks — backslashes inside them are literals, not escapes.
export const unescapeMarkdown = (str: string): string =>
  str.replaceAll(
    /(```[\s\S]*?```|`[^`\n]*`)|\\([\\`*_{}[\]()#+\-.!])/g,
    (_, code, escaped) => code ?? escaped,
  );

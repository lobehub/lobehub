export interface GreetingLink {
  end: number;
  href: string;
  /** Offset into `plain` where the link label starts. */
  start: number;
  text: string;
}

export interface ParsedGreeting {
  /** Link spans positioned against `plain`, ready to render as anchors. */
  links: GreetingLink[];
  /** The visible text, with all markdown syntax removed. */
  plain: string;
}

const MARKDOWN_LINK_RE = /\[([^\]]+)\]\(([^)\s]+)\)/g;

/** Bare references the generator emits without the markdown link form. */
const AUTO_LINK_PATTERNS = [
  {
    build: (match: string) => `https://github.com/lobehub/lobehub/issues/${match.slice(1)}`,
    regex: /#\d+/g,
  },
];

/**
 * Whitespace is collapsed *before* link offsets are computed — doing it after
 * would shift every span and mis-position the anchors.
 */
const normalize = (raw: string): string => raw.replaceAll('**', '').replaceAll(/\s+/gu, ' ').trim();

/**
 * The daily-brief welcome is authored as markdown for a two-line block of its
 * own, where each line is a separate finding. The portrait speaks a single
 * line instead, so only the first finding is taken — concatenating both reads
 * as one run-on claim, and overruns the bubble.
 *
 * Links are kept as spans rather than flattened: the generator wraps every
 * referenced entity in `[name](url)` precisely so the reader can jump to it.
 */
export const parseGreetingLine = (welcome: string): ParsedGreeting => {
  const firstLine = welcome.split('\n').find((line) => line.trim().length > 0) ?? '';
  const cleaned = normalize(firstLine);

  const links: GreetingLink[] = [];
  let plain = '';
  let lastIndex = 0;
  MARKDOWN_LINK_RE.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = MARKDOWN_LINK_RE.exec(cleaned)) !== null) {
    plain += cleaned.slice(lastIndex, match.index);
    const start = plain.length;
    plain += match[1];
    links.push({ end: plain.length, href: match[2], start, text: match[1] });
    lastIndex = match.index + match[0].length;
  }
  plain += cleaned.slice(lastIndex);

  for (const { regex, build } of AUTO_LINK_PATTERNS) {
    regex.lastIndex = 0;
    let auto: RegExpExecArray | null;
    while ((auto = regex.exec(plain)) !== null) {
      links.push({
        end: auto.index + auto[0].length,
        href: build(auto[0]),
        start: auto.index,
        text: auto[0],
      });
    }
  }

  // Explicit markdown links were pushed first, so they win any overlap.
  links.sort((a, b) => a.start - b.start || a.end - b.end);
  const accepted: GreetingLink[] = [];
  let lastEnd = 0;
  for (const link of links) {
    if (link.start >= lastEnd) {
      accepted.push(link);
      lastEnd = link.end;
    }
  }

  return { links: accepted, plain };
};

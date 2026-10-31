import os from 'node:os';

/**
 * Local redaction for terminal evidence.
 *
 * Runs before anything is written to the bundle, so the unredacted output never
 * reaches disk, let alone the upload. Records which rule fired and how often —
 * never the value it replaced.
 *
 * Conservative by design: a false positive costs a reader one masked token, a
 * false negative publishes a credential.
 */

interface Rule {
  /** Matches the secret; `group` (if set) narrows the replacement to one capture. */
  group?: number;
  name: string;
  pattern: RegExp;
  replacement: string;
}

export interface RedactionMatch {
  end: number;
  replacement: string;
  rule: string;
  start: number;
}

export interface Redactor {
  /** Non-overlapping matches over `text`, earliest first. */
  find: (text: string) => RedactionMatch[];
}

/**
 * Environment variable names whose values are treated as secrets wherever they
 * appear. Deliberately not bare `SESSION` / `AUTH`: those name ids and URLs
 * (`*_SESSION_ID`, `NEXTAUTH_URL`) whose masking only destroys context.
 */
const SECRET_ENV_NAME =
  /TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|ACCESS_?KEY|PRIVATE_?KEY|CREDENTIAL|COOKIE|DSN|DATABASE_URL|CONNECTION_STRING/i;
const MIN_ENV_SECRET_LENGTH = 6;

const BUILTIN_RULES: Rule[] = [
  {
    name: 'private-key',
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replacement: '[REDACTED:private-key]',
  },
  {
    name: 'jwt',
    pattern: /\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/g,
    replacement: '[REDACTED:jwt]',
  },
  {
    name: 'api-token',
    pattern:
      /\b(?:sk-[\w-]{16,}|gh[oprsu]_[A-Za-z\d]{20,}|github_pat_\w{20,}|xox[abeoprs]-[\dA-Za-z-]{10,}|AIza[\w-]{35}|AKIA[\dA-Z]{16}|glpat-[\w-]{20,}|npm_[A-Za-z\d]{36})/g,
    replacement: '[REDACTED:token]',
  },
  {
    group: 1,
    name: 'auth-header',
    pattern: /\b(?:Bearer|Basic|Token)\s+([\w+./=~-]{8,})/gi,
    replacement: '[REDACTED]',
  },
  {
    group: 1,
    name: 'url-credentials',
    pattern: /[a-z][\d+.a-z-]*:\/\/([^\s/:@]+:[^\s/@]+)@/gi,
    replacement: '[REDACTED]',
  },
  {
    group: 1,
    name: 'secret-assignment',
    pattern:
      // A `$VAR` reference is a name, not a value — the env rule masks its value.
      /\b[\w.-]*(?:password|passwd|secret|token|api[_-]?key|access[_-]?key)[\w.-]*["']?\s*[:=]\s*["']?(?!\$)([^\s"',;]{4,})/gi,
    replacement: '[REDACTED]',
  },
];

const escapeRegExp = (value: string) => value.replaceAll(/[$()*+.?[\\\]^{|}]/g, '\\$&');

/** `/regex/flags` is a pattern; anything else is matched literally. */
export const parseCustomPattern = (raw: string): RegExp => {
  const match = /^\/(.+)\/([a-z]*)$/s.exec(raw);
  if (!match) return new RegExp(escapeRegExp(raw), 'g');
  const flags = match[2].includes('g') ? match[2] : `${match[2]}g`;
  return new RegExp(match[1], flags);
};

export interface RedactorOptions {
  /** Extra user patterns from `--redact`. */
  custom?: string[];
  env?: NodeJS.ProcessEnv;
  /** Replace the home directory with `~` (paths carry the account name). */
  homeDir?: string | null;
}

export const createRedactor = (options: RedactorOptions = {}): Redactor => {
  const env = options.env ?? process.env;
  const rules: Rule[] = [];

  // Exact values of secret-looking variables first: they are certain, and the
  // longest values go first so one secret containing another masks whole.
  const envSecrets = Object.entries(env)
    .filter(
      (entry): entry is [string, string] =>
        SECRET_ENV_NAME.test(entry[0]) &&
        typeof entry[1] === 'string' &&
        entry[1].length >= MIN_ENV_SECRET_LENGTH,
    )
    .sort((a, b) => b[1].length - a[1].length);
  for (const [name, value] of envSecrets)
    rules.push({
      name: 'env-secret',
      pattern: new RegExp(escapeRegExp(value), 'g'),
      replacement: `[REDACTED:${name}]`,
    });

  rules.push(...BUILTIN_RULES);

  for (const [index, raw] of (options.custom ?? []).entries())
    rules.push({
      name: `custom-${index + 1}`,
      pattern: parseCustomPattern(raw),
      replacement: '[REDACTED]',
    });

  const home = options.homeDir === undefined ? os.homedir() : options.homeDir;
  if (home && home.length > 1)
    rules.push({
      name: 'home-path',
      pattern: new RegExp(`${escapeRegExp(home)}(?=$|[/\\\\\\s"'])`, 'g'),
      replacement: '~',
    });

  // A rule that masks one capture group needs that group's own position: the
  // value can also occur earlier in the match (`password=pass` holds "pass" in
  // its field name), so searching for its text would mask the wrong span and
  // publish the secret. The `d` flag records where each group matched.
  const compiled = rules.map((rule) => ({
    ...rule,
    pattern:
      rule.group && !rule.pattern.hasIndices
        ? new RegExp(rule.pattern.source, `${rule.pattern.flags}d`)
        : rule.pattern,
  }));

  return {
    find: (text) => {
      const matches: RedactionMatch[] = [];
      for (const rule of compiled) {
        rule.pattern.lastIndex = 0;
        for (const match of text.matchAll(rule.pattern)) {
          if (match[0].length === 0) continue;
          const span = rule.group
            ? match.indices?.[rule.group]
            : [match.index!, match.index! + match[0].length];
          if (!span || span[1] <= span[0]) continue;
          const [start, end] = span;
          matches.push({
            end,
            replacement: rule.replacement,
            rule: rule.name,
            start,
          });
        }
      }
      // Earliest first; at the same start the longer (or earlier-listed) rule wins.
      matches.sort((a, b) => a.start - b.start || b.end - a.end);
      const kept: RedactionMatch[] = [];
      let cursor = 0;
      for (const match of matches) {
        if (match.start < cursor) continue;
        kept.push(match);
        cursor = match.end;
      }
      return kept;
    },
  };
};

/** Tally of rule → hits across every piece of text a bundle redacted. */
export class RedactionLog {
  private counts = new Map<string, number>();

  record(matches: RedactionMatch[]) {
    for (const match of matches)
      this.counts.set(match.rule, (this.counts.get(match.rule) ?? 0) + 1);
  }

  toJSON() {
    return [...this.counts].map(([rule, count]) => ({ count, rule }));
  }
}

export const applyMatches = (text: string, matches: RedactionMatch[]): string => {
  let out = '';
  let cursor = 0;
  for (const match of matches) {
    out += text.slice(cursor, match.start) + match.replacement;
    cursor = match.end;
  }
  return out + text.slice(cursor);
};

export const redactText = (redactor: Redactor, log: RedactionLog, text: string): string => {
  const matches = redactor.find(text);
  log.record(matches);
  return applyMatches(text, matches);
};

/**
 * Redact a stream recorded as chunks without breaking its timing. A secret is
 * often split across two writes, so matching runs over the joined stream and
 * each match is cut back into the chunks it spans: the replacement lands in the
 * chunk where the secret started, and the rest of it disappears from the later
 * chunks — every chunk keeps its own timestamp.
 */
export const redactChunks = (redactor: Redactor, log: RedactionLog, chunks: string[]): string[] => {
  const joined = chunks.join('');
  const matches = redactor.find(joined);
  log.record(matches);
  if (matches.length === 0) return chunks;

  const out: string[] = [];
  let offset = 0;
  let m = 0;
  for (const chunk of chunks) {
    const start = offset;
    const end = offset + chunk.length;
    let piece = '';
    let cursor = start;
    while (m < matches.length && matches[m].start < end) {
      const match = matches[m];
      if (match.start >= cursor) {
        piece += joined.slice(cursor, match.start) + match.replacement;
      }
      cursor = Math.max(cursor, Math.min(match.end, end));
      if (match.end > end) break; // continues into the next chunk
      m += 1;
    }
    piece += joined.slice(Math.max(cursor, start), end);
    out.push(piece);
    offset = end;
  }
  return out;
};

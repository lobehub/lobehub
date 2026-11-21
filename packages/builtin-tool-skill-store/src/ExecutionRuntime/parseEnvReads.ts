import type { SkillEnvRequirement } from '../types';

/**
 * Reads how a script uses each environment variable: whether it can run without
 * it, which variables stand in for it, and what value it falls back to.
 */
export interface EnvFinding {
  /** Variables that can stand in for this one, in the script's fallback order */
  alternatives: string[];
  /** A bare shell `$NAME`, which may be a local variable rather than the environment */
  bare?: boolean;
  /** The fallback value; `null` when one exists but is not a literal in this file */
  defaultValue: string | null;
  hasDefault: boolean;
  name: string;
  requirement: SkillEnvRequirement;
}

/** `unresolved`: a name this file gives no string value for, so it may be empty or None. */
interface Fallback {
  unresolved?: boolean;
  value: string | null;
}

interface EnvRead {
  end: number;
  fallback?: Fallback;
  name: string;
  /** Where a read passed as this read's default starts: `getenv("A", getenv("B"))` */
  nestedStart?: number;
  start: number;
  strict: boolean;
}

const NAME = String.raw`[A-Za-z_][A-Za-z0-9_]*`;
const QUOTE = `['"\`]`;
const STRING = String.raw`"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|\`(?:[^\`\\\n]|\\.)*\``;
const VALUE = String.raw`${STRING}|[A-Za-z_][\w.]*`;
/** A lookahead, so a read passed as the default is still matched on its own. */
const ARGUMENT = String.raw`(?=(?:\s*,\s*(?<arg>${VALUE}))?)`;
/** The module a read is called on (`os.`), so a chain's next read is found where it starts. */
const MODULE = String.raw`(?:[A-Za-z_]\w*\.)?`;
/** `os.environ["X"] = …` sets the variable, it does not need it. */
const NOT_ASSIGNED = String.raw`(?!\s*=[^=])`;

const READ_PATTERNS: { call: boolean; pattern: RegExp; strict: boolean }[] = [
  // Python os.environ.get("X", default)
  {
    call: true,
    pattern: new RegExp(
      String.raw`\b${MODULE}environ\.get\s*\(\s*${QUOTE}(?<name>${NAME})${QUOTE}${ARGUMENT}`,
      'g',
    ),
    strict: false,
  },
  // Python os.environ["X"] raises when unset
  {
    call: false,
    pattern: new RegExp(
      String.raw`\b${MODULE}environ\s*\[\s*${QUOTE}(?<name>${NAME})${QUOTE}\s*\]${NOT_ASSIGNED}`,
      'g',
    ),
    strict: true,
  },
  // Python os.getenv("X", default), Go os.Getenv("X"), PHP getenv('X')
  {
    call: true,
    pattern: new RegExp(
      String.raw`\b${MODULE}[Gg]etenv\s*\(\s*${QUOTE}(?<name>${NAME})${QUOTE}${ARGUMENT}`,
      'g',
    ),
    strict: false,
  },
  // Node process.env.X, Bun.env.X, import.meta.env.X
  {
    call: false,
    pattern: new RegExp(
      String.raw`\b(?:process|Bun|import\.meta)\.env\.(?<name>${NAME})${NOT_ASSIGNED}`,
      'g',
    ),
    strict: false,
  },
  {
    call: false,
    pattern: new RegExp(
      String.raw`\b(?:process|Bun|import\.meta)\.env\[\s*${QUOTE}(?<name>${NAME})${QUOTE}\s*\]${NOT_ASSIGNED}`,
      'g',
    ),
    strict: false,
  },
  // Deno.env.get("X")
  {
    call: true,
    pattern: new RegExp(String.raw`\bDeno\.env\.get\(\s*${QUOTE}(?<name>${NAME})${QUOTE}`, 'g'),
    strict: false,
  },
  // Ruby ENV.fetch("X") raises when unset, unless it has a default
  {
    call: true,
    pattern: new RegExp(
      String.raw`\bENV\.fetch\s*\(\s*${QUOTE}(?<name>${NAME})${QUOTE}${ARGUMENT}`,
      'g',
    ),
    strict: true,
  },
  // Ruby ENV["X"]
  {
    call: false,
    pattern: new RegExp(
      String.raw`\bENV\[\s*${QUOTE}(?<name>${NAME})${QUOTE}\s*\]${NOT_ASSIGNED}`,
      'g',
    ),
    strict: false,
  },
];

const CHAIN_OPERATOR = /^\s*(?:\bor\b|\|\||\?\?)\s*/;
const CHAIN_VALUE = new RegExp(`^(?:${VALUE})`);
const CONSTANT = new RegExp(
  String.raw`^[ \t]*(?:export\s+)?(?:(?:const|let|var)\s+)?(${NAME})\s*(?::\s*[\w.[\]| ]+)?=\s*(${STRING})\s*(?:;|#|$)`,
  'gm',
);
const NO_VALUE = new Set(['False', 'None', 'false', 'nil', 'null', 'undefined']);

const SHELL_EXPANSION = /\$\{([A-Za-z_]\w*)(:?[-?])([^}]*)\}/g;
const SHELL_BARE = /\$(?:\{([A-Z][A-Z0-9_]*)\}|([A-Z][A-Z0-9_]*))/g;

const unquote = (token: string) => token.slice(1, -1);
const isQuoted = (token: string) => /^["'`]/.test(token);

const readConstants = (code: string) =>
  new Map([...code.matchAll(CONSTANT)].map((match) => [match[1], unquote(match[2])]));

/**
 * `undefined` means no guaranteed fallback: an empty string or None leaves the
 * value unset, and a function call may return nothing.
 */
const parseFallback = (
  token: string | undefined,
  constants: Map<string, string>,
  after = '',
): Fallback | undefined => {
  if (!token || NO_VALUE.has(token)) return undefined;
  const next = after.trimStart()[0];
  if (next === '(') return undefined;
  // `"a" + b`, `"%s" % b`, `"{}".format(b)`: there is a value, but not this literal.
  const isComputed = next === '+' || next === '%' || next === '.';
  if (isQuoted(token)) {
    const value = unquote(token);
    if (!value) return undefined;
    return { value: isComputed || (token[0] === '`' && value.includes('${')) ? null : value };
  }
  const constant = constants.get(token);
  if (constant === undefined || isComputed) return { unresolved: true, value: null };
  return constant ? { value: constant } : undefined;
};

/** Index just past the `)` closing a call whose `(` is already behind `from`. */
const endOfCall = (code: string, from: number) => {
  let depth = 1;
  let quote = '';
  for (let i = from; i < Math.min(code.length, from + 500); i++) {
    const char = code[i];
    if (quote) {
      if (char === '\\') i++;
      else if (char === quote) quote = '';
    } else if (char === '"' || char === "'" || char === '`') quote = char;
    else if (char === '(') depth++;
    else if (char === ')' && --depth === 0) return i + 1;
  }
  return from;
};

const collectReads = (code: string, constants: Map<string, string>) => {
  const reads = new Map<number, EnvRead>();
  const argStarts = new Map<number, number>();
  for (const { call, pattern, strict } of READ_PATTERNS) {
    for (const match of code.matchAll(pattern)) {
      const start = match.index;
      const matchEnd = start + match[0].length;
      const arg = match.groups?.arg;
      const argStart = arg
        ? matchEnd + (/^\s*,\s*/.exec(code.slice(matchEnd))?.[0].length ?? 0)
        : undefined;
      if (argStart !== undefined) argStarts.set(start, argStart);
      reads.set(start, {
        end: call ? endOfCall(code, matchEnd) : matchEnd,
        fallback:
          arg && argStart !== undefined
            ? parseFallback(
                arg,
                constants,
                code.slice(argStart + arg.length, argStart + arg.length + 20),
              )
            : undefined,
        name: match.groups!.name,
        start,
        strict: strict && !arg,
      });
    }
  }
  for (const [start, argStart] of argStarts) {
    if (!reads.has(argStart)) continue;
    const read = reads.get(start)!;
    read.fallback = undefined;
    read.nestedStart = argStart;
  }
  return reads;
};

/** Adds a read and any read passed as its default. */
const addToChain = (chain: EnvRead[], read: EnvRead, reads: Map<number, EnvRead>) => {
  chain.push(read);
  let nested = read.nestedStart === undefined ? undefined : reads.get(read.nestedStart);
  while (nested) {
    // Arguments run first, so a strict default raises even when the outer variable is set.
    if (nested.strict) chain.splice(chain.indexOf(read), 0, nested);
    else chain.push(nested);
    nested = nested.nestedStart === undefined ? undefined : reads.get(nested.nestedStart);
  }
};

const toFinding = (read: EnvRead, chain: EnvRead[], terminal?: Fallback) => {
  // A strict read raises when unset, so nothing after it can stand in for it.
  const strictIndex = chain.findIndex((item) => item.strict);
  const reachable = strictIndex === -1 ? chain : chain.slice(0, strictIndex + 1);
  if (!reachable.includes(read)) {
    return {
      alternatives: [],
      defaultValue: null,
      hasDefault: false,
      name: read.name,
      requirement: 'unknown',
    } satisfies EnvFinding;
  }

  const fallbacks = [
    ...reachable.flatMap((item) => (item.fallback ? [item.fallback] : [])),
    ...(strictIndex === -1 && terminal ? [terminal] : []),
  ];
  const fallback = fallbacks.find((item) => !item.unresolved);
  if (!fallback && fallbacks.length > 0) {
    return {
      alternatives: [],
      defaultValue: null,
      hasDefault: false,
      name: read.name,
      requirement: 'unknown',
    } satisfies EnvFinding;
  }
  const names = [...new Set(reachable.map((item) => item.name))];
  const requirement: SkillEnvRequirement = fallback
    ? 'optional'
    : names.length > 1
      ? 'one_of'
      : read.strict
        ? 'required'
        : 'unknown';

  return {
    alternatives: requirement === 'one_of' ? names.filter((name) => name !== read.name) : [],
    defaultValue: fallback?.value ?? null,
    hasDefault: Boolean(fallback),
    name: read.name,
    requirement,
  } satisfies EnvFinding;
};

const parseShellReads = (code: string): EnvFinding[] => {
  const findings: EnvFinding[] = [];
  for (const [, name, operator, word] of code.matchAll(SHELL_EXPANSION)) {
    if (operator.endsWith('?')) {
      findings.push({
        alternatives: [],
        defaultValue: null,
        hasDefault: false,
        name,
        requirement: 'required',
      });
    } else if (word && !word.includes('$')) {
      findings.push({
        alternatives: [],
        defaultValue: word.replace(/^(["'])(.*)\1$/, '$2'),
        hasDefault: true,
        name,
        requirement: 'optional',
      });
    } else {
      findings.push({
        alternatives: [],
        defaultValue: null,
        hasDefault: false,
        name,
        requirement: 'unknown',
      });
    }
  }
  for (const match of code.matchAll(SHELL_BARE)) {
    findings.push({
      alternatives: [],
      bare: true,
      defaultValue: null,
      hasDefault: false,
      name: match[1] ?? match[2],
      requirement: 'unknown',
    });
  }
  return findings;
};

export const parseEnvReads = (code: string, isShell: boolean): EnvFinding[] => {
  const constants = readConstants(code);
  const reads = collectReads(code, constants);
  const visited = new Set<number>();
  const findings: EnvFinding[] = [];

  for (const read of [...reads.values()].sort((a, b) => a.start - b.start)) {
    if (visited.has(read.start)) continue;
    const chain: EnvRead[] = [];
    addToChain(chain, read, reads);
    let terminal: Fallback | undefined;
    let cursor = read.end;

    for (;;) {
      const operator = CHAIN_OPERATOR.exec(code.slice(cursor, cursor + 200));
      if (!operator) break;
      const next = cursor + operator[0].length;
      const nextRead = reads.get(next);
      if (nextRead) {
        addToChain(chain, nextRead, reads);
        cursor = nextRead.end;
        continue;
      }
      const value = CHAIN_VALUE.exec(code.slice(next, next + 500))?.[0];
      terminal = parseFallback(
        value,
        constants,
        code.slice(next + (value?.length ?? 0), next + 520),
      );
      break;
    }

    for (const item of chain) {
      visited.add(item.start);
      findings.push(toFinding(item, chain, terminal));
    }
  }

  return isShell ? [...findings, ...parseShellReads(code)] : findings;
};

const RANK: Record<SkillEnvRequirement, number> = {
  one_of: 2,
  optional: 1,
  required: 3,
  unknown: 0,
};

/** The strongest requirement wins when a variable is read in several places. */
export const mergeEnvFindings = (a: EnvFinding, b: EnvFinding): EnvFinding => {
  const winner = RANK[b.requirement] > RANK[a.requirement] ? b : a;
  return {
    ...winner,
    alternatives:
      winner.requirement === 'one_of' ? [...new Set([...a.alternatives, ...b.alternatives])] : [],
    bare: a.bare && b.bare,
  };
};

export const strongerRequirement = (a: SkillEnvRequirement, b: SkillEnvRequirement) =>
  RANK[b] > RANK[a] ? b : a;

const DOC_NOT_NEEDED =
  /\boptional(?:ly)?\b|\b(?:no|not|don'?t|doesn'?t)\b.*\b(?:need(?:ed|s)?|required?|necessary)\b|无需|不需要|不用|可选/i;
const DOC_NEEDED = /\b(?:required|must|needs?)\b|必需|必须|需要/i;

/** What a doc sentence says about a credential it names. */
export const docRequirement = (sentence: string): SkillEnvRequirement => {
  if (DOC_NOT_NEEDED.test(sentence)) return 'optional';
  return DOC_NEEDED.test(sentence) ? 'required' : 'unknown';
};

import type {
  SkillEndpointUsage,
  SkillEnvVarUsage,
  SkillPackageFile,
  SkillRequirements,
} from '../types';

/**
 * Static scan of a skill package for what it needs at run time: the
 * environment variables its scripts read (credentials vs. other settings), the
 * credentials its docs tell the user to set, and the network hosts its scripts
 * contact. It reads the files themselves because the description is free text
 * written by the author and can contradict them.
 *
 * It is a static check: names or URLs a script builds at run time are missed.
 */

const SCRIPT_FILE = /\.(?:py|js|mjs|cjs|ts|mts|cts|jsx|tsx|sh|bash|zsh|rb|go|php|pl|ps1|r|lua)$/i;
const SHELL_FILE = /\.(?:sh|bash|zsh)$/i;
const DOC_FILE = /\.(?:md|mdx|markdown|txt)$/i;
const ENV_FILE = /(?:^|\/)\.env(?:\.[\w-]+)?$/;

/** Larger files are generated or vendored data, not something a skill author writes. */
const MAX_FILE_LENGTH = 512 * 1024;

const ENV_NAME = String.raw`[A-Za-z_][A-Za-z0-9_]*`;

/** Explicit environment reads, one capture group: the variable name. */
const ENV_READS: RegExp[] = [
  // Python os.environ.get("X") / os.environ["X"] / os.getenv("X"); Go os.Getenv("X"); PHP getenv('X')
  new RegExp(String.raw`\benviron(?:\.get)?\s*[[(]\s*['"](${ENV_NAME})['"]`, 'g'),
  new RegExp(String.raw`\b[Gg]etenv\s*\(\s*['"](${ENV_NAME})['"]`, 'g'),
  // Node process.env.X / process.env["X"], Bun.env.X, import.meta.env.X
  new RegExp(String.raw`\b(?:process|Bun|import\.meta)\.env\.(${ENV_NAME})`, 'g'),
  new RegExp(String.raw`\b(?:process|Bun|import\.meta)\.env\[\s*['"\`](${ENV_NAME})['"\`]`, 'g'),
  // Deno.env.get("X")
  new RegExp(String.raw`\bDeno\.env\.get\(\s*['"](${ENV_NAME})['"]`, 'g'),
  // Ruby ENV["X"] / ENV.fetch("X")
  new RegExp(String.raw`\bENV(?:\.fetch\s*\(|\[)\s*['"](${ENV_NAME})['"]`, 'g'),
];

/** `$NAME` / `${NAME}` in shell scripts; only credential-like names are kept (skips $HOME, $1…). */
const SHELL_VAR = /\$\{?([A-Z][A-Z0-9_]*)/g;

/** UPPER_SNAKE words in docs; only credential-like names are kept. */
const DOC_VAR = /\b([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\b/g;

/** `NAME=` lines of a dotenv file. */
const ENV_FILE_LINE = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/gm;

/** API keys, tokens, secrets, passwords: the values a user has to supply. */
const CREDENTIAL_NAME =
  /(?:^|_)(?:API_?KEY|ACCESS_?KEY(?:_ID)?|SECRET(?:_?KEY)?|PRIVATE_?KEY|KEY|TOKEN|PASSWORD|PASSWD|PAT|CREDENTIALS?)$/;

/** Process/OS variables that say nothing about what the skill needs. */
const IGNORED_ENV = new Set([
  'APPDATA',
  'CI',
  'DEBUG',
  'HOME',
  'HOSTNAME',
  'LANG',
  'LOG_LEVEL',
  'NODE_ENV',
  'PATH',
  'PWD',
  'PYTHONIOENCODING',
  'PYTHONPATH',
  'SHELL',
  'TEMP',
  'TERM',
  'TMP',
  'TMPDIR',
  'USER',
  'USERNAME',
  'USERPROFILE',
  'VERBOSE',
]);
const IGNORED_ENV_PREFIX = /^(?:LC_|XDG_)/;

const URL_HOST =
  /\bhttps?:\/\/([\w.-]+\.[a-z]{2,}|\d{1,3}(?:\.\d{1,3}){3})(?=[\s"'`/:?#)\]},;>]|$)/gi;

const COMMENT_LINE = /^\s*(?:#|\/\/|\/?\*)/;

/** Hosts that are never contacted: loopback, documentation examples, XML namespaces. */
const IGNORED_HOST =
  /^(?:localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|(?:[\w-]+\.)*example\.(?:com|org|net)|www\.w3\.org|schemas\.openxmlformats\.org|schemas\.microsoft\.com|purl\.org|ns\.adobe\.com)$/i;

export const isCredentialName = (name: string) => CREDENTIAL_NAME.test(name.toUpperCase());

const isIgnoredEnv = (name: string) => IGNORED_ENV.has(name) || IGNORED_ENV_PREFIX.test(name);

const isScannable = (file: SkillPackageFile) =>
  file.content.length <= MAX_FILE_LENGTH && !file.content.includes('\0');

class UsageMap {
  private map = new Map<string, Set<string>>();

  add(key: string, file: string) {
    const files = this.map.get(key) ?? new Set<string>();
    files.add(file);
    this.map.set(key, files);
  }

  has(key: string) {
    return this.map.has(key);
  }

  keys() {
    return [...this.map.keys()];
  }

  files(key: string) {
    return [...(this.map.get(key) ?? [])].sort();
  }
}

const matchAll = (content: string, pattern: RegExp) =>
  [...content.matchAll(pattern)].map((match) => match[1]);

export const scanSkillFiles = (files: SkillPackageFile[]): SkillRequirements => {
  const envReads = new UsageMap();
  const documented = new UsageMap();
  const hosts = new UsageMap();
  const scripts: string[] = [];

  for (const file of files) {
    const { path } = file;
    const isScript = SCRIPT_FILE.test(path);
    if (isScript) scripts.push(path);
    if (!isScannable(file)) continue;

    if (isScript) {
      for (const pattern of ENV_READS) {
        for (const name of matchAll(file.content, pattern)) {
          if (!isIgnoredEnv(name)) envReads.add(name, path);
        }
      }
      if (SHELL_FILE.test(path)) {
        for (const name of matchAll(file.content, SHELL_VAR)) {
          if (isCredentialName(name)) envReads.add(name, path);
        }
      }
      // A URL on a comment-only line is a reference link, not a call.
      const code = file.content
        .split('\n')
        .filter((line) => !COMMENT_LINE.test(line))
        .join('\n');
      for (const host of matchAll(code, URL_HOST)) {
        const normalized = host.toLowerCase();
        if (!IGNORED_HOST.test(normalized)) hosts.add(normalized, path);
      }
    } else if (DOC_FILE.test(path)) {
      for (const name of matchAll(file.content, DOC_VAR)) {
        if (isCredentialName(name)) documented.add(name, path);
      }
    } else if (ENV_FILE.test(path)) {
      for (const name of matchAll(file.content, ENV_FILE_LINE)) {
        if (isCredentialName(name)) documented.add(name, path);
      }
    }
  }

  const toUsage = (name: string): SkillEnvVarUsage => ({
    files: [...new Set([...envReads.files(name), ...documented.files(name)])].sort(),
    name,
  });

  const credentialNames = new Set([
    ...envReads.keys().filter((name) => isCredentialName(name)),
    ...documented.keys(),
  ]);
  const settingNames = envReads.keys().filter((name) => !credentialNames.has(name));

  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

  return {
    credentials: [...credentialNames].map(toUsage).sort(byName),
    endpoints: hosts
      .keys()
      .map((host): SkillEndpointUsage => ({ files: hosts.files(host), host }))
      .sort((a, b) => a.host.localeCompare(b.host)),
    scripts: scripts.sort(),
    settings: settingNames.map(toUsage).sort(byName),
  };
};

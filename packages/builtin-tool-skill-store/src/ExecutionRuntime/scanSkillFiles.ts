import type {
  SkillDataEgress,
  SkillEgressContentType,
  SkillEgressSignal,
  SkillEndpointUsage,
  SkillEnvRequirement,
  SkillEnvVarUsage,
  SkillPackageFile,
  SkillRequirements,
} from '../types';
import {
  docRequirement,
  type EnvFinding,
  mergeEnvFindings,
  parseEnvReads,
  settleFallbackGroups,
  strongerRequirement,
} from './parseEnvReads';

/**
 * Static scan of a skill package for what it needs at run time: the
 * environment variables its scripts read (credentials vs. other settings) with
 * whether each is required and its default, the credentials its docs tell the
 * user to set, and what data its scripts send where. It reads the files themselves because the description is free text
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

/** UPPER_SNAKE words in docs; only credential-like names are kept. */
const DOC_VAR = /\b([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\b/g;

/** Settings that point the scripts somewhere else: a base URL, endpoint or host. */
const DESTINATION_SETTING = /(?:URL|URI|ENDPOINT|HOST|BASE)$/;

/** What in a script's code shows the kind of content it sends. */
const CONTENT_SIGNALS: [Exclude<SkillEgressContentType, 'unknown'>, RegExp][] = [
  ['audio', /\binput_audio\b|\baudio_url\b|content-type['"`]?\s*:\s*['"`]audio\//i],
  ['file', /multipart\/form-data|\bFormData\b|\binput_file\b|\.post\([^)]*\bfiles\s*=/i],
  [
    'image',
    /\bimage_url\b|\binput_image\b|\binline_data\b|data:image\/|content-type['"`]?\s*:\s*['"`]image\//i,
  ],
  ['text', /['"`]messages['"`]|\bmessages\s*=|['"`]prompt['"`]\s*:|['"`]text['"`]\s*:/],
  ['video', /\bvideo_url\b|content-type['"`]?\s*:\s*['"`]video\//i],
];

/** An HTTP client: data can leave even when the URL is built at run time. */
const NETWORK_CLIENT =
  /\b(?:requests|httpx|aiohttp|axios|urllib\.request|http\.client)\b|\bfetch\s*\(|\b(?:curl|wget)\s|\bnew\s+(?:OpenAI|Anthropic)\(|\b(?:OpenAI|Anthropic)\(|net\/http/;

const MAX_DEFAULT_LENGTH = 200;

/** A sample value in place of a key: the script still cannot authenticate with it. */
const PLACEHOLDER_DEFAULT = /your|x{3,}|change.?me|placeholder|replace|example|dummy|todo|^<.*>$/i;

/** One doc sentence says one thing about the credentials it names. */
const DOC_SENTENCE = /\n|(?<=[.!?;])\s+|(?<=[。！？；])/;

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

/** A default can be a real secret or a URL with one in it: never pass those on. */
const safeDefault = (name: string, value: string | null) => {
  if (value === null) return null;
  if (isCredentialName(name)) return '[redacted]';
  return value.replace(/\/\/[^/@\s]+@/, '//[redacted]@').slice(0, MAX_DEFAULT_LENGTH);
};

const findContentSignals = (code: string, file: string): SkillEgressSignal[] =>
  CONTENT_SIGNALS.flatMap(([contentType, pattern]) => {
    const signal = pattern.exec(code)?.[0];
    return signal ? [{ contentType, file, signal }] : [];
  });

export const scanSkillFiles = (files: SkillPackageFile[]): SkillRequirements => {
  const envReads = new UsageMap();
  const documented = new UsageMap();
  const hosts = new UsageMap();
  const findings = new Map<string, EnvFinding>();
  const docRequirements = new Map<string, SkillEnvRequirement>();
  const scriptCode = new Map<string, string>();
  const scripts: string[] = [];

  const noteDoc = (name: string, path: string, requirement: SkillEnvRequirement) => {
    documented.add(name, path);
    const current = docRequirements.get(name);
    docRequirements.set(name, current ? strongerRequirement(current, requirement) : requirement);
  };

  for (const file of files) {
    const { path } = file;
    const isScript = SCRIPT_FILE.test(path);
    if (isScript) scripts.push(path);
    if (!isScannable(file)) continue;

    if (isScript) {
      // A comment-only line is a note or a reference link, not a read or a call.
      const code = file.content
        .split('\n')
        .filter((line) => !COMMENT_LINE.test(line))
        .join('\n');
      scriptCode.set(path, code);

      for (const finding of parseEnvReads(code, SHELL_FILE.test(path))) {
        const { name } = finding;
        if (isIgnoredEnv(name) || (finding.bare && !isCredentialName(name))) continue;
        envReads.add(name, path);
        const current = findings.get(name);
        findings.set(name, current ? mergeEnvFindings(current, finding) : finding);
      }
      for (const host of matchAll(code, URL_HOST)) {
        const normalized = host.toLowerCase();
        if (!IGNORED_HOST.test(normalized)) hosts.add(normalized, path);
      }
    } else if (DOC_FILE.test(path)) {
      for (const sentence of file.content.split(DOC_SENTENCE)) {
        for (const name of matchAll(sentence, DOC_VAR)) {
          if (isCredentialName(name)) noteDoc(name, path, docRequirement(sentence));
        }
      }
    } else if (ENV_FILE.test(path)) {
      for (const name of matchAll(file.content, ENV_FILE_LINE)) {
        if (isCredentialName(name)) noteDoc(name, path, 'unknown');
      }
    }
  }

  settleFallbackGroups(findings);

  const toUsage = (name: string): SkillEnvVarUsage => {
    const found = findings.get(name);
    const finding =
      found?.hasDefault &&
      isCredentialName(name) &&
      PLACEHOLDER_DEFAULT.test(found.defaultValue ?? '')
        ? { ...found, defaultValue: null, hasDefault: false, requirement: 'unknown' as const }
        : found;
    const doc = docRequirements.get(name);
    // The code is the better witness; docs only settle what the code leaves open.
    const requirement =
      !finding || finding.requirement === 'unknown'
        ? (doc ?? finding?.requirement ?? 'unknown')
        : finding.requirement;
    const hasDefault = requirement === 'optional' && Boolean(finding?.hasDefault);

    return {
      alternatives: requirement === 'one_of' ? (finding?.alternatives ?? []) : [],
      defaultValue: hasDefault ? safeDefault(name, finding?.defaultValue ?? null) : null,
      files: [...new Set([...envReads.files(name), ...documented.files(name)])].sort(),
      hasDefault,
      name,
      requirement,
    };
  };

  const credentialNames = new Set([
    ...envReads.keys().filter((name) => isCredentialName(name)),
    ...documented.keys(),
  ]);
  const settingNames = envReads.keys().filter((name) => !credentialNames.has(name));

  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

  const credentials = [...credentialNames].map(toUsage).sort(byName);
  const settings = settingNames.map(toUsage).sort(byName);
  const endpoints = hosts
    .keys()
    .map((host): SkillEndpointUsage => ({ files: hosts.files(host), host }))
    .sort((a, b) => a.host.localeCompare(b.host));

  const destinationSettings = settings.filter(({ name }) => DESTINATION_SETTING.test(name));
  const egressFiles = new Set([
    ...endpoints.flatMap(({ files: usedIn }) => usedIn),
    ...destinationSettings.flatMap(({ files: usedIn }) => usedIn),
    ...[...scriptCode].flatMap(([path, code]) => (NETWORK_CLIENT.test(code) ? [path] : [])),
  ]);
  const signals = [...egressFiles]
    .sort()
    .flatMap((path) => findContentSignals(scriptCode.get(path) ?? '', path));
  const occurs = egressFiles.size > 0;
  const contentTypes = [...new Set(signals.map(({ contentType }) => contentType))].sort();

  const dataEgress: SkillDataEgress = {
    configurableVia: destinationSettings.map(({ name }) => name),
    contentTypes: occurs && contentTypes.length === 0 ? ['unknown'] : contentTypes,
    occurs,
    signals,
    targets: endpoints.map(({ host }) => host),
  };

  return {
    apiKeyNames: credentials.map(({ name }) => name),
    credentials,
    dataEgress,
    endpoints,
    requiresApiKey: credentials.some(({ requirement }) => requirement !== 'optional'),
    scripts: scripts.sort(),
    settings,
  };
};

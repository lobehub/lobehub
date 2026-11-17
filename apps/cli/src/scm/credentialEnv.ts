import path from 'node:path';

export const SCM_CREDENTIAL_BLOCKED_ENV = [
  'GH_ENTERPRISE_TOKEN',
  'GH_TOKEN',
  'GITHUB_ENTERPRISE_TOKEN',
  'GITHUB_TOKEN',
] as const;

export const SCM_CREDENTIAL_TOOL = 'scm-credential';

const GITHUB_URL = 'https://github.com';

export interface ScmCredentialEnvOptions {
  gitEmail?: string;
  gitName?: string;
  helperCommand: string;
  jwtFile?: string;
  shimDir: string;
}

export const ghShimBinDir = (shimDir: string) => path.join(shimDir, 'bin');
export const ghShimConfigDir = (shimDir: string) => path.join(shimDir, 'gh-config');

const gitConfigEntries = (helperCommand: string): [string, string][] => [
  // The empty value resets the helpers a lower-priority config set for github.com,
  // so a device login can never answer for the requester.
  [`credential.${GITHUB_URL}.helper`, ''],
  [`credential.${GITHUB_URL}.helper`, helperCommand],
  [`credential.${GITHUB_URL}.useHttpPath`, 'true'],
  [`url.${GITHUB_URL}/.insteadOf`, 'git@github.com:'],
  [`url.${GITHUB_URL}/.insteadOf`, 'ssh://git@github.com/'],
];

export const applyScmCredentialEnv = (
  baseEnv: NodeJS.ProcessEnv,
  options: ScmCredentialEnvOptions,
): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = { ...baseEnv };
  for (const key of SCM_CREDENTIAL_BLOCKED_ENV) delete env[key];

  const existing = Number.parseInt(env.GIT_CONFIG_COUNT ?? '0', 10);
  let index = Number.isFinite(existing) && existing > 0 ? existing : 0;
  for (const [key, value] of gitConfigEntries(options.helperCommand)) {
    env[`GIT_CONFIG_KEY_${index}`] = key;
    env[`GIT_CONFIG_VALUE_${index}`] = value;
    index += 1;
  }
  env.GIT_CONFIG_COUNT = String(index);

  env.LOBEHUB_SCM_CREDENTIAL = '1';
  env.GIT_TERMINAL_PROMPT = '0';
  env.GCM_INTERACTIVE = 'never';
  env.GH_CONFIG_DIR = ghShimConfigDir(options.shimDir);
  env.PATH = env.PATH
    ? `${ghShimBinDir(options.shimDir)}${path.delimiter}${env.PATH}`
    : ghShimBinDir(options.shimDir);

  if (options.gitName && options.gitEmail) {
    env.GIT_AUTHOR_NAME = options.gitName;
    env.GIT_AUTHOR_EMAIL = options.gitEmail;
    env.GIT_COMMITTER_NAME = options.gitName;
    env.GIT_COMMITTER_EMAIL = options.gitEmail;
  }
  if (options.jwtFile) env.LOBEHUB_SCM_JWT_FILE = options.jwtFile;

  return env;
};

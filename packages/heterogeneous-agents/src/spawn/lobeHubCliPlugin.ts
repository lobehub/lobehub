import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';

import type { AgentContentBlock, AgentPromptInput } from '../protocol';
import {
  LOBEHUB_CLI_GUIDE_CONTEXT,
  lobeHubCliGuide,
  lobeHubCliGuideBlock,
  lobeHubCliSkillBody,
  lobeHubCliSkillDescription,
} from '../protocol/lobeHubCliGuide';

/**
 * Delivers the `lh` guide to Claude Code as a native skill instead of text in
 * the user's turn (lobehub/lobehub#20675).
 *
 * Claude Code loads a plugin directory for one session with `--plugin-dir`
 * (the Agent SDK's `plugins` option), leaving the user's own `~/.claude`
 * untouched. Only the skill's description stays in context; the body is read
 * when a request concerns LobeHub. A plugin is passed on every spawn, resumed
 * turns included, so it never needs the once-per-session bookkeeping the
 * in-message copy does — and nothing lands in the CLI's transcript as words
 * the user said.
 *
 * Only a Claude Code that loads plugin skills gets this; an older or unknown
 * build keeps the in-message guide exactly as before, since it would reject
 * `--plugin-dir` and fail to launch.
 */

export const LOBEHUB_CLI_PLUGIN_NAME = 'lobehub';
export const LOBEHUB_CLI_SKILL_NAME = 'lobehub';

/**
 * Claude Code loads skills, plugin ones included, from 2.0.20 (plugins arrived
 * in 2.0.12). The CLI binary checks accept any version, so this gates delivery.
 */
export const CLAUDE_CODE_PLUGIN_SKILLS_MIN_VERSION = '2.0.20';

/** `claude --disable-slash-commands` disables every skill, plugin ones included. */
const CLAUDE_CODE_DISABLE_SKILLS_FLAG = '--disable-slash-commands';

// Only start at the beginning of a digit run. Otherwise a malformed banner
// retries the match at every digit, taking quadratic time on long numeric runs.
const parseVersion = (version: string) =>
  version
    .match(/(?<!\d)(\d+)\.(\d+)\.(\d+)/)
    ?.slice(1, 4)
    .map(Number);

/** Whether a reported Claude Code version loads plugin skills; unknown means no. */
export const claudeCodeLoadsPluginSkills = (version: string | undefined): boolean => {
  const actual = version ? parseVersion(version) : undefined;
  if (!actual) return false;

  const minimum = parseVersion(CLAUDE_CODE_PLUGIN_SKILLS_MIN_VERSION)!;
  const differing = actual.findIndex((part, index) => part !== minimum[index]);
  return differing === -1 || actual[differing] > minimum[differing];
};

const hasFlag = (args: readonly string[], flag: string) =>
  args.some((arg) => arg === flag || arg.startsWith(`${flag}=`));

const toBlocks = (prompt: AgentPromptInput): AgentContentBlock[] =>
  typeof prompt === 'string' ? (prompt ? [{ text: prompt, type: 'text' }] : []) : prompt;

/** `## LobeHub CLI (`lh`)` — also how dispatchers predating the tag start the guide. */
const LOBEHUB_CLI_GUIDE_HEADING = lobeHubCliGuide.slice(0, lobeHubCliGuide.indexOf('\n'));

/** Whether the prompt carries the guide, tagged or from a dispatcher predating the tag. */
const carriesLobeHubCliGuide = (prompt: AgentPromptInput) =>
  toBlocks(prompt).some(
    (block) =>
      block.type === 'text' &&
      (block.context === LOBEHUB_CLI_GUIDE_CONTEXT ||
        block.text.startsWith(LOBEHUB_CLI_GUIDE_HEADING)),
  );

/** Plugin files keyed by their path inside the plugin root. */
export const buildLobeHubCliPluginFiles = (): Record<string, string> => ({
  '.claude-plugin/plugin.json': `${JSON.stringify(
    {
      description: 'The LobeHub CLI (`lh`) for agents running inside a LobeHub conversation.',
      name: LOBEHUB_CLI_PLUGIN_NAME,
      version: '1.0.0',
    },
    null,
    2,
  )}\n`,
  // A JSON string is a valid YAML double-quoted scalar, and the description
  // contains `: `, which a plain YAML scalar cannot.
  [`skills/${LOBEHUB_CLI_SKILL_NAME}/SKILL.md`]: [
    '---',
    `name: ${LOBEHUB_CLI_SKILL_NAME}`,
    `description: ${JSON.stringify(lobeHubCliSkillDescription)}`,
    '---',
    '',
    lobeHubCliSkillBody,
    '',
  ].join('\n'),
});

/**
 * Where the plugin may live, in order. The shared temp directory comes first;
 * the user's cache directory backs it when the temp root is unusable (another
 * user created it, a cleanup changed it), so the plugin is only unavailable when
 * neither can be written — and then Claude Code's own writes fail as well.
 */
const defaultRootDirs = () => {
  const owner = typeof process.getuid === 'function' ? String(process.getuid()) : 'user';
  return [
    path.join(tmpdir(), `lobehub-cli-plugin-${owner}`),
    path.join(homedir(), '.cache', 'lobehub-cli-plugin'),
  ];
};

/**
 * The root may sit in a shared temp directory, and whatever a plugin there says
 * is read by the agent as instructions. Only a real directory this user owns
 * and nobody else can write into is used.
 */
const assertPrivateRoot = async (rootDir: string) => {
  await mkdir(rootDir, { mode: 0o700, recursive: true });
  const stat = await lstat(rootDir);
  if (!stat.isDirectory()) throw new Error(`${rootDir} is not a directory`);
  if (typeof process.getuid !== 'function') return;
  if (stat.uid !== process.getuid()) throw new Error(`${rootDir} belongs to another user`);
  if ((stat.mode & 0o077) !== 0) throw new Error(`${rootDir} is accessible to other users`);
};

const pathExists = async (target: string) =>
  lstat(target).then(
    () => true,
    () => false,
  );

const materializePlugin = async (rootDir: string): Promise<string> => {
  const files = buildLobeHubCliPluginFiles();
  // Content-addressed: every run of the same guide shares one directory, so a
  // path an earlier turn saw stays valid, and a changed guide never reuses it.
  const digest = createHash('sha256').update(JSON.stringify(files)).digest('hex').slice(0, 16);
  const pluginDir = path.join(rootDir, digest);

  await assertPrivateRoot(rootDir);
  if (await pathExists(path.join(pluginDir, `skills/${LOBEHUB_CLI_SKILL_NAME}/SKILL.md`))) {
    return pluginDir;
  }

  // Written aside and renamed into place, so a concurrent run never loads a
  // half-written plugin.
  const stagingDir = path.join(rootDir, `.staging-${randomUUID()}`);
  try {
    for (const [relativePath, content] of Object.entries(files)) {
      const target = path.join(stagingDir, relativePath);
      await mkdir(path.dirname(target), { mode: 0o700, recursive: true });
      await writeFile(target, content, { mode: 0o600 });
    }
    await rename(stagingDir, pluginDir).catch(async (error) => {
      // Another run finished first; its copy is identical.
      if (!(await pathExists(pluginDir))) throw error;
    });
    return pluginDir;
  } finally {
    await rm(stagingDir, { force: true, recursive: true });
  }
};

/**
 * Directory of the plugin carrying the guide, written on first use and checked
 * on every spawn — a long-lived desktop process outlives temp-directory
 * cleanups. Resolves `undefined` when no root can be written safely; callers
 * then keep the guide in the prompt, so a run never loses it.
 */
export const resolveLobeHubCliPluginDir = async (
  options: { rootDir?: string } = {},
): Promise<string | undefined> => {
  for (const rootDir of options.rootDir ? [options.rootDir] : defaultRootDirs()) {
    const pluginDir = await materializePlugin(rootDir).catch(() => undefined);
    if (pluginDir) return pluginDir;
  }
};

/** Drop the in-message copy of the guide, which a native skill now carries. */
export const omitLobeHubCliGuide = (prompt: AgentPromptInput): AgentPromptInput =>
  typeof prompt === 'string'
    ? prompt
    : prompt.filter(
        (block) => block.type !== 'text' || block.context !== LOBEHUB_CLI_GUIDE_CONTEXT,
      );

export interface ClaudeCodeLobeHubCliDelivery {
  /** Spawn arguments loading the plugin; empty when the guide is in the prompt. */
  args: string[];
  /** The prompt to send: without the in-message guide exactly when `args` carries it. */
  prompt: AgentPromptInput;
}

/**
 * Prepare a Claude Code spawn to carry the guide as a skill. Every Claude Code
 * launch inside a LobeHub conversation goes through this, so the plugin and the
 * removal of the in-message copy always come together.
 *
 * Without the plugin the guide stays in the prompt as before. A resumed turn
 * carries no in-message copy (`isNewSession`) and its earlier turns may have
 * had the plugin, so there the guide is put back into the prompt rather than
 * lost. An appended system prompt would not do: on `--resume` Claude Code keeps
 * the system prompt the session started with and ignores a new one.
 *
 * @param args the spawn's own arguments; skills disabled there keep the guide in
 * the prompt.
 * @param options.version the Claude Code version the caller detected.
 * @param options.resumed whether this launch resumes a native session.
 */
export const prepareClaudeCodeLobeHubCli = async (
  prompt: AgentPromptInput,
  args: readonly string[] = [],
  options: { resumed?: boolean; rootDir?: string; version?: string } = {},
): Promise<ClaudeCodeLobeHubCliDelivery> => {
  if (hasFlag(args, CLAUDE_CODE_DISABLE_SKILLS_FLAG)) return { args: [], prompt };
  if (!claudeCodeLoadsPluginSkills(options.version)) return { args: [], prompt };

  const pluginDir = await resolveLobeHubCliPluginDir(options);
  if (pluginDir) return { args: ['--plugin-dir', pluginDir], prompt: omitLobeHubCliGuide(prompt) };

  if (!options.resumed || carriesLobeHubCliGuide(prompt)) return { args: [], prompt };
  return { args: [], prompt: [lobeHubCliGuideBlock, ...toBlocks(prompt)] };
};

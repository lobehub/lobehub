import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import type { Command } from 'commander';
import pc from 'picocolors';

import { cliVersion } from '../pkg';
import { outputJson } from '../utils/format';
import { AGENTS_SKILLS_DIR, linkHarnessSkills, type LinkResult } from '../utils/skillWiring';
import { artboardSkillBody, artboardSkillDescription } from './artboardSkillContent';

export const ARTBOARD_SKILL_ID = 'lobehub-artboard';

const VERSION_LINE = /^\s+version:\s*["']?(\d+)\.(\d+)\.(\d+)/m;

const renderSkill = (version: string) =>
  [
    '---',
    `name: ${ARTBOARD_SKILL_ID}`,
    `description: ${JSON.stringify(artboardSkillDescription)}`,
    'metadata:',
    `  version: ${JSON.stringify(version)}`,
    '---',
    '',
    artboardSkillBody,
  ].join('\n');

const versionParts = (text: string) => {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(text);
  return match ? match.slice(1).map(Number) : undefined;
};

const installedVersion = (skillFile: string) => {
  if (!existsSync(skillFile)) return undefined;
  const match = VERSION_LINE.exec(readFileSync(skillFile, 'utf8'));
  return match ? match.slice(1, 4).join('.') : undefined;
};

const isNewer = (installed: string | undefined, current: string) => {
  const a = installed && versionParts(installed);
  const b = versionParts(current);
  if (!a || !b) return false;
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index];
  }
  return false;
};

const listFiles = (directory: string): string[] => {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? listFiles(entryPath) : [entryPath];
  });
};

const printLinks = (links: LinkResult[]) => {
  const arrow = pc.dim('  ↳');
  for (const link of links) {
    if (link.kind === 'linked' || link.kind === 'linked-single')
      console.log(`${arrow} linked ${link.link} → ${pc.dim(link.target)}`);
    else if (link.kind === 'already')
      console.log(`${arrow} ${pc.dim(`${link.link} already linked`)}`);
    else if (link.kind === 'skipped')
      console.log(`${arrow} ${pc.yellow(`skipped ${link.link}: ${link.reason}`)}`);
    else
      console.log(
        `${arrow} ${pc.dim('no harness dirs detected — agents that read .agents/skills pick it up automatically')}`,
      );
  }
};

interface InitOptions {
  dir?: string;
  json?: boolean;
}

const initAction = (options: InitOptions) => {
  const baseDir = options.dir ? path.resolve(options.dir) : process.cwd();
  const skillDir = path.join(baseDir, AGENTS_SKILLS_DIR, ARTBOARD_SKILL_ID);
  const skillFile = path.join(skillDir, 'SKILL.md');
  if (lstatSync(skillDir, { throwIfNoEntry: false })?.isSymbolicLink())
    throw new Error(
      `${skillDir} is a symbolic link; remove it or point --dir at the repository that owns the skill`,
    );
  const installed = installedVersion(skillFile);

  if (isNewer(installed, cliVersion)) {
    const result = {
      dir: skillDir,
      installedVersion: installed,
      links: [] as LinkResult[],
      removed: [] as string[],
      skill: ARTBOARD_SKILL_ID,
      status: 'newer-installed' as const,
      version: cliVersion,
      written: [] as string[],
    };
    if (options.json) return outputJson(result);
    console.log(
      `${pc.yellow('!')} ${ARTBOARD_SKILL_ID} v${installed} is already installed and this lh is v${cliVersion}; nothing changed`,
    );
    return;
  }

  const removed = listFiles(skillDir)
    .filter((file) => file !== skillFile)
    .map((file) => {
      rmSync(file, { force: true });
      return path.relative(skillDir, file).split(path.sep).join('/');
    });
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(skillFile, renderSkill(cliVersion), 'utf8');
  const links = linkHarnessSkills(baseDir, ARTBOARD_SKILL_ID);

  const result = {
    dir: skillDir,
    installedVersion: installed,
    links,
    removed,
    skill: ARTBOARD_SKILL_ID,
    status: 'installed' as const,
    version: cliVersion,
    written: ['SKILL.md'],
  };
  if (options.json) return outputJson(result);
  console.log(
    `${pc.green('✓')} ${pc.bold(ARTBOARD_SKILL_ID)} ${pc.dim(`v${cliVersion}`)} skill → ${pc.dim(path.relative(process.cwd(), skillDir) || skillDir)}`,
  );
  console.log(`  written: SKILL.md${removed.length ? ` · removed: ${removed.join(', ')}` : ''}`);
  printLinks(links);
  console.log(pc.dim('  Commit these files so agents working in this repository load the skill.'));
};

export const registerArtboardSkillCommand = (artboard: Command) => {
  artboard
    .command('skill')
    .description('The agent skill that tells CLI agents when and how to use the artboard')
    .command('init')
    .description(
      'Write the artboard skill into this repository (.agents/skills) or bring it up to date',
    )
    .option('--dir <path>', 'Target working directory (default: current dir)')
    .option('--json', 'Print structured JSON')
    .action(initAction);
};

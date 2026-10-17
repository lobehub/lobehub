import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { Command } from 'commander';
import pc from 'picocolors';

import type { TrpcClient } from '../../api/client';
import { ensureAcceptanceDirIgnored } from '../../utils/acceptanceDir';
import { outputJson } from '../../utils/format';
import type { LinkResult } from '../../utils/skillWiring';
import { linkHarnessSkills } from '../../utils/skillWiring';

// ── install ──

export interface InstallOptions {
  dir?: string;
  force?: boolean;
  json?: boolean | string;
  skill: string;
  skillVersion?: string;
}

const listMaterializedFiles = (directory: string): string[] => {
  if (!existsSync(directory)) return [];

  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? listMaterializedFiles(entryPath) : [entryPath];
  });
};

export async function installAction(options: InstallOptions, client: TrpcClient): Promise<void> {
  const version = options.skillVersion?.replace(/^v/, '');
  const bundle = await client.verify.getSkillBundle.query({
    identifier: options.skill,
    ...(version === undefined ? {} : { version }),
  });
  // Older servers ignore the requested version. A matching version label alone
  // does not prove that the content was resolved from the requested tag.
  if (
    version !== undefined &&
    (bundle.version !== version || bundle.source?.ref !== `v${version}`)
  ) {
    throw new Error(
      `Requested acceptance skill ${version} from tag v${version}, but the server returned version ${bundle.version ?? 'unknown'} from ${bundle.source?.ref ?? 'an unknown source'}. Update your server to support skill tag selection.`,
    );
  }

  // The acceptance skeleton lands under `.agents/skills/<id>` — the harness dir
  // the project's own `.agents/acceptance/` adapter sits beside. Invariant: this
  // is a materialized artifact, re-installed to update, never hand-edited. It is
  // meant to be COMMITTED: the consuming repo reviews skill changes like any
  // other file, so install never writes an ignore entry for it.
  const baseDir = options.dir ? path.resolve(options.dir) : process.cwd();
  const skillDir = path.join(baseDir, '.agents', 'skills', bundle.identifier);

  // path → content for SKILL.md plus every resource file.
  const entries: [string, string][] = [
    ['SKILL.md', bundle.content],
    ...Object.entries(bundle.files),
  ];

  const written: string[] = [];
  const skipped: string[] = [];
  for (const [rel, content] of entries) {
    const dest = path.join(skillDir, rel);
    if (existsSync(dest) && !options.force) {
      skipped.push(rel);
      continue;
    }
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, content, 'utf8');
    written.push(rel);
  }

  // `acceptance update` is an explicit force-refresh of a materialized skill,
  // not a merge into a hand-maintained directory. Remove files that belonged to
  // an older bundle so renamed/split references cannot remain discoverable.
  const removed: string[] = [];
  if (options.force) {
    const currentEntries = new Set(entries.map(([rel]) => path.normalize(rel)));
    for (const file of listMaterializedFiles(skillDir)) {
      const relativePath = path.relative(skillDir, file);
      if (currentEntries.has(path.normalize(relativePath))) continue;

      rmSync(file, { force: true });
      removed.push(relativePath.split(path.sep).join('/'));
    }
  }

  const links = linkHarnessSkills(baseDir, bundle.identifier);
  // `link` predates `links` and stays as a compatibility alias for the Claude
  // result — `install --json link` and `.link.kind` readers keep working.
  const link: LinkResult = links.find((l) => 'link' in l && l.link.startsWith('.claude')) ?? {
    kind: 'none',
  };
  // The skill is committed; its OUTPUT is not. Seed the artifact directory's own
  // self-ignoring file now, so the first run's screenshots never land as
  // untracked noise in a repo that has never heard of us.
  const ignored = ensureAcceptanceDirIgnored(baseDir);

  const result = {
    dir: skillDir,
    ignored,
    link,
    links,
    removed,
    skill: bundle.identifier,
    skipped,
    source: bundle.source,
    // Recorded so a caller can tell which version now sits on disk; the
    // installed SKILL.md carries the same value in its frontmatter.
    version: bundle.version,
    written,
  };
  if (options.json !== undefined) {
    outputJson(result, typeof options.json === 'string' ? options.json : undefined);
    return;
  }
  const versionLabel = bundle.version ? pc.dim(` v${bundle.version}`) : '';
  console.log(
    `${pc.green('✓')} ${pc.bold(bundle.name)}${versionLabel} skill → ${pc.dim(path.relative(process.cwd(), skillDir) || skillDir)}`,
  );
  console.log(
    `  ${written.length} written${skipped.length ? `, ${skipped.length} skipped` : ''}${removed.length ? `, ${removed.length} stale removed` : ''}`,
  );
  if (skipped.length > 0) console.log(pc.dim(`  (skipped existing — pass --force to overwrite)`));
  printWiring(links);
}

function printWiring(links: LinkResult[]): void {
  const arrow = pc.dim('  ↳');
  for (const link of links) {
    switch (link.kind) {
      case 'linked':
      case 'linked-single': {
        console.log(`${arrow} linked ${link.link} → ${pc.dim(link.target)}`);
        break;
      }
      case 'already': {
        console.log(`${arrow} ${pc.dim(`${link.link} already linked`)}`);
        break;
      }
      case 'skipped': {
        console.log(`${arrow} ${pc.yellow(`skipped ${link.link}: ${link.reason}`)}`);
        break;
      }
      default: {
        console.log(
          `${arrow} ${pc.dim('no harness dirs detected — agents that read .agents/skills pick it up automatically')}`,
        );
        break;
      }
    }
  }
}

export function withInstallOptions(cmd: Command): Command {
  return cmd
    .option('--dir <path>', 'Target working directory (default: current dir)')
    .option('--skill <id>', 'Skill identifier to pull', 'acceptance')
    .option(
      '--skill-version <version>',
      'Install a specific skill tag (default: latest default-branch source)',
    )
    .option('--force', 'Overwrite existing skill files')
    .option('--json [fields]', 'Output JSON');
}

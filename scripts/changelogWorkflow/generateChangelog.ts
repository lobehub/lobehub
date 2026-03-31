import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { consola } from 'consola';

const REPO_URL = 'https://github.com/lobehub/lobe-chat';
const CHANGELOG_TITLE = '<a name="readme-top"></a>\n\n# Changelog';
const BACK_TO_TOP = `<div align="right">

[![](https://img.shields.io/badge/-BACK_TO_TOP-151515?style=flat-square)](#readme-top)

</div>`;

interface Commit {
  hash: string;
  issues: string[];
  scope: string;
  subject: string;
  type: string;
}

interface TypeConfig {
  detail: string;
  emoji: string;
  summary: string;
}

const TYPE_MAP: Record<string, TypeConfig> = {
  feat: { emoji: '✨', summary: 'Features', detail: "What's improved" },
  fix: { emoji: '🐛', summary: 'Bug Fixes', detail: "What's fixed" },
  hotfix: { emoji: '🐛', summary: 'Bug Fixes', detail: "What's fixed" },
  perf: { emoji: '⚡', summary: 'Performance Improvements', detail: 'Performance Improvements' },
  style: { emoji: '💄', summary: 'Styles', detail: 'Styles' },
  refactor: { emoji: '♻️', summary: 'Code Refactoring', detail: 'Code Refactoring' },
  build: { emoji: '👷', summary: 'Build System', detail: 'Build System' },
};

const git = (cmd: string) => execSync(`git ${cmd}`, { encoding: 'utf8' }).trim();

const getLastTag = (): string | null => {
  try {
    return git('describe --tags --abbrev=0 HEAD');
  } catch {
    return null;
  }
};

const getPreviousTag = (currentTag: string): string | null => {
  try {
    return git(`describe --tags --abbrev=0 ${currentTag}^`);
  } catch {
    return null;
  }
};

const getCommits = (from: string | null): Commit[] => {
  const range = from ? `${from}..HEAD` : 'HEAD';
  const SEP = '---COMMIT_SEP---';
  let log: string;
  try {
    log = git(`log ${range} --format="%H %s${SEP}"`);
  } catch {
    return [];
  }

  const commits: Commit[] = [];
  for (const entry of log.split(SEP)) {
    const line = entry.trim();
    if (!line) continue;

    const spaceIdx = line.indexOf(' ');
    if (spaceIdx === -1) continue;
    const hash = line.slice(0, spaceIdx);
    let subject = line.slice(spaceIdx + 1);

    // Strip leading gitmoji (unicode emoji or :shortcode: format)
    subject = subject
      .replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}]+\s*/u, '')
      .replace(/^:[a-z_]+:\s*/i, '');

    // Parse conventional commit: type(scope): message
    const match = subject.match(/^(\w+)(?:\(([^)]*)\))?:\s*(.+)/);
    if (!match) continue;

    const [, type, scope, msg] = match;
    if (!TYPE_MAP[type]) continue;

    // Extract issue references
    const issues: string[] = [];
    const issueRe = /#(\d+)/g;
    let m: RegExpExecArray | null;
    while ((m = issueRe.exec(msg)) !== null) {
      issues.push(m[1]);
    }

    // Strip issue refs from subject: "closes #123", "(#123)"
    const cleanSubject = msg
      .replaceAll(/,?\s*closes?\s+#\d+/gi, '')
      .replaceAll(/\s*\(#\d+\)/g, '')
      .trim();

    commits.push({
      hash: hash.slice(0, 7),
      issues,
      scope: scope || 'misc',
      subject: cleanSubject,
      type,
    });
  }

  return commits;
};

const groupByType = (commits: Commit[]) => {
  const groups: Record<string, Commit[]> = {};
  for (const commit of commits) {
    const key = commit.type === 'hotfix' ? 'fix' : commit.type;
    if (!groups[key]) groups[key] = [];
    groups[key].push(commit);
  }
  return groups;
};

const formatSummarySection = (groups: Record<string, Commit[]>): string => {
  const sections: string[] = [];
  for (const [type, commits] of Object.entries(groups)) {
    const cfg = TYPE_MAP[type];
    if (!cfg) continue;
    sections.push(`#### ${cfg.emoji} ${cfg.summary}\n`);
    for (const c of commits) {
      sections.push(`- **${c.scope}**: ${c.subject}.`);
    }
    sections.push('');
  }
  return sections.join('\n');
};

const formatDetailSection = (groups: Record<string, Commit[]>): string => {
  const sections: string[] = [];
  for (const [type, commits] of Object.entries(groups)) {
    const cfg = TYPE_MAP[type];
    if (!cfg) continue;
    sections.push(`#### ${cfg.detail}\n`);
    for (const c of commits) {
      const closes = c.issues.map((i) => `closes [#${i}](${REPO_URL}/issues/${i})`).join(', ');
      const ref = `([${c.hash}](${REPO_URL}/commit/${c.hash}))`;
      const suffix = [closes, ref].filter(Boolean).join(' ');
      sections.push(`- **${c.scope}**: ${c.subject}${closes ? ', ' : ' '}${suffix}`);
    }
    sections.push('');
  }
  return sections.join('\n');
};

const run = () => {
  const root = path.resolve(__dirname, '../..');
  const pkgPath = path.resolve(root, 'package.json');
  const changelogPath = path.resolve(root, 'CHANGELOG.md');
  const version = JSON.parse(readFileSync(pkgPath, 'utf8')).version;
  const today = new Date().toISOString().split('T')[0];

  const lastTag = getLastTag();
  const prevTag = lastTag ? getPreviousTag(lastTag) : null;
  const fromTag = lastTag ?? prevTag;

  const commits = getCommits(fromTag);

  if (commits.length === 0) {
    consola.warn('No conventional commits found since last tag, skipping changelog generation');
    return;
  }

  const groups = groupByType(commits);

  // Determine heading level: minor (feat) -> ##, patch -> ###
  const headingLevel = groups['feat'] ? '##' : '###';
  const compareUrl = fromTag
    ? `${REPO_URL}/compare/${fromTag}...v${version}`
    : `${REPO_URL}/releases/tag/v${version}`;

  const entry = [
    `${headingLevel} [Version ${version}](${compareUrl})`,
    '',
    `<sup>Released on **${today}**</sup>`,
    '',
    formatSummarySection(groups),
    '<br/>',
    '',
    '<details>',
    '<summary><kbd>Improvements and Fixes</kbd></summary>',
    '',
    formatDetailSection(groups),
    '</details>',
    '',
    BACK_TO_TOP,
  ].join('\n');

  const currentFile = readFileSync(changelogPath, 'utf8').trim();
  const currentContent = currentFile.startsWith(CHANGELOG_TITLE)
    ? currentFile.slice(CHANGELOG_TITLE.length).trim()
    : currentFile;

  const newContent = `${CHANGELOG_TITLE}\n\n${entry}\n\n${currentContent}\n`;
  writeFileSync(changelogPath, newContent);
  consola.success(`Changelog updated for v${version}`);
};

run();

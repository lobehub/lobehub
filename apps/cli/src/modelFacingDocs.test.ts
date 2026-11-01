import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import type { Command } from 'commander';
import { describe, expect, it } from 'vitest';

import { createProgram } from './program';

/**
 * Prose that agents read and then copy into `lh` calls. When it names a command
 * or flag the CLI no longer has, the model burns a round on `unknown command` /
 * `unknown option` and often falls back to a worse path — so every `lh …`
 * snippet in these files is checked against the real command tree.
 */
const repoRoot = path.resolve(__dirname, '../../..');
const lobehubSkillDir = path.join(repoRoot, 'packages/builtin-skills/src/lobehub');

const MODEL_FACING_FILES = [
  path.join(lobehubSkillDir, 'content.ts'),
  ...readdirSync(path.join(lobehubSkillDir, 'references'))
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .map((name) => path.join(lobehubSkillDir, 'references', name)),
  path.join(repoRoot, 'apps/server/src/services/verify/executor.ts'),
];

const program = createProgram() as Command;

const findSubcommand = (cmd: Command, name: string) =>
  cmd.commands.find((sub) => sub.name() === name || sub.aliases().includes(name));

/**
 * Every `lh …` inline code span and every code-block command starting with
 * `lh `, with backslash line continuations joined into one invocation.
 */
const extractSnippets = (source: string): string[] => {
  const text = source.replaceAll('\\`', '`');
  const snippets = new Set<string>();
  for (const match of text.matchAll(/`((?:[^\n`]*?\s)?lh [a-z][^\n`]*)`/g)) snippets.add(match[1]);
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    let command = lines[i].trim();
    if (!/^lh [a-z]/.test(command)) continue;
    // Template-literal sources escape the continuation backslash as `\\`.
    while (/\\+$/.test(command) && i + 1 < lines.length) {
      command = `${command.replace(/\\+$/, '').trimEnd()} ${lines[++i].trim()}`;
    }
    snippets.add(command);
  }
  return [...snippets];
};

const checkSnippet = (snippet: string): string[] => {
  const tokens = snippet.replace(/^.*?\blh /, '').split(/\s+/);
  let cmd = program;
  const commandPath: string[] = [];

  let consumed = 0;
  for (const token of tokens) {
    if (cmd.commands.length === 0 || !/^[a-z][\w-]*$/.test(token)) break;
    const sub = findSubcommand(cmd, token);
    if (!sub) {
      // A command that takes positional args may legitimately be followed by a word.
      if (cmd.registeredArguments.length > 0) break;
      return [`unknown command "lh ${[...commandPath, token].join(' ')}"`];
    }
    cmd = sub;
    commandPath.push(token);
    consumed += 1;
  }
  if (cmd === program) return [];

  const problems: string[] = [];
  // Match each flag on its own so an adjacent flag is never swallowed as the
  // previous one's value; the following token is only inspected for arity.
  for (const match of snippet.matchAll(/(?<![\w-])(--?[a-z][\w-]*)/gi)) {
    const flag = match[1];
    if (flag === '--help' || flag === '-h') continue;
    const option = cmd.options.find((opt) => opt.long === flag || opt.short === flag);
    if (!option) {
      problems.push(`unknown option ${flag} on "lh ${commandPath.join(' ')}"`);
      continue;
    }
    const next = snippet
      .slice(match.index + flag.length)
      .trim()
      .split(/\s+/)[0];
    if (option.required && (!next || next.startsWith('-') || next.startsWith(']'))) {
      problems.push(`option ${flag} on "lh ${commandPath.join(' ')}" requires a value`);
    }
  }

  // A bare `lh kb view` in prose names the command; only a written-out
  // invocation (anything after the command path) must be complete.
  const rest = tokens.slice(consumed).filter(Boolean);
  if (rest.length === 0) return problems;

  // Keep bracket context: a mandatory flag written as `[--flag <v>]` tells the
  // model it may be omitted, which commander then rejects.
  const used = new Set<string>();
  const bracketed = new Set<string>();
  for (const match of snippet.matchAll(/(?<![\w-])(--?[a-z][\w-]*)/gi)) {
    const before = snippet.slice(0, match.index);
    const depth = (before.match(/\[/g) ?? []).length - (before.match(/\]/g) ?? []).length;
    (depth > 0 ? bracketed : used).add(match[1]);
  }
  for (const option of cmd.options) {
    if (!option.mandatory || used.has(option.long!) || used.has(option.short!)) continue;
    problems.push(
      bracketed.has(option.long!) || bracketed.has(option.short!)
        ? `required option ${option.long} on "lh ${commandPath.join(' ')}" is shown as optional`
        : `missing required option ${option.long} on "lh ${commandPath.join(' ')}"`,
    );
  }

  // Count positionals outside `[...]` groups, skipping flags and their values.
  let depth = 0;
  let positionals = 0;
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];
    const opens = (token.match(/\[/g) ?? []).length;
    const closes = (token.match(/\]/g) ?? []).length;
    const optional = depth > 0 || token.startsWith('[');
    depth += opens - closes;
    if (optional) continue;
    if (token.startsWith('-')) {
      const option = cmd.options.find((opt) => opt.long === token || opt.short === token);
      if (option?.required || option?.optional) i += 1;
      continue;
    }
    positionals += 1;
  }
  const requiredArgs = cmd.registeredArguments.filter((arg) => arg.required).length;
  if (positionals < requiredArgs) {
    problems.push(
      `missing required argument on "lh ${commandPath.join(' ')}" (expects ${requiredArgs}, got ${positionals})`,
    );
  }
  return problems;
};

describe('model-facing lh CLI docs', () => {
  it.each(MODEL_FACING_FILES.map((file) => [path.relative(repoRoot, file), file]))(
    '%s only references commands and flags the CLI accepts',
    (_label, file) => {
      const problems = extractSnippets(readFileSync(file, 'utf8')).flatMap((snippet) =>
        checkSnippet(snippet).map((problem) => `${problem}  <- ${snippet}`),
      );
      expect(problems).toEqual([]);
    },
  );

  it('flags a stale command and a stale option', () => {
    expect(checkSnippet('lh config whoami')).toEqual(['unknown command "lh config"']);
    expect(checkSnippet('lh eval run get --run-id <id>')).toEqual([
      'unknown option --run-id on "lh eval run get"',
      'missing required option --id on "lh eval run get"',
    ]);
    expect(checkSnippet('lh agent run -a <id> --replay')).toEqual([
      'option --replay on "lh agent run" requires a value',
    ]);
    expect(checkSnippet('lh whoami --json')).toEqual([]);
    // An adjacent flag must be validated, not read as the previous flag's value.
    expect(checkSnippet('lh usage --daily --stale')).toEqual([
      'unknown option --stale on "lh usage"',
    ]);
    expect(
      checkSnippet('lh eval run-topic report-result --run-id <id> --topic-id <id> --score <n>'),
    ).toEqual([
      'missing required option --correct on "lh eval run-topic report-result"',
      'missing required option --result-json on "lh eval run-topic report-result"',
    ]);
    expect(checkSnippet('lh kb upload <kbId> [--parent <folderId>]')).toEqual([
      'missing required argument on "lh kb upload" (expects 2, got 1)',
    ]);
    // A mandatory flag inside `[...]` reads as optional to the model.
    expect(checkSnippet('lh plugin install -i <identifier> [--manifest <json>]')).toEqual([
      'required option --manifest on "lh plugin install" is shown as optional',
    ]);
    expect(checkSnippet('lh plugin install -i <identifier> --manifest <json>')).toEqual([]);
    // A bare command name in prose is a reference, not an invocation.
    expect(checkSnippet('lh kb view')).toEqual([]);
  });
});

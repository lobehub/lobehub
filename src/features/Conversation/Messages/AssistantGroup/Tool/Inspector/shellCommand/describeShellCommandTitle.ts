import { getRunCommandDisplayCommand } from '@lobechat/shared-tool-ui/run-command';

import { describeShellCommand } from './commandAction';
import { readableShellCommand } from './readableShellCommand';
import { describeShellScript } from './scriptStep';
import type { ShellCommandAction, ShellCommandTitle } from './types';

const EXPLORE_ACTIONS: ReadonlySet<ShellCommandAction> = new Set([
  'findFiles',
  'list',
  'listFiles',
  'read',
  'search',
]);

const basename = (path: string): string => {
  const trimmed = path.replace(/[/\\]+$/, '');
  return trimmed.split(/[/\\]/).pop() || trimmed;
};

/**
 * Reading a skill's `skills/<name>/SKILL.md` is how Codex uses a skill, so the
 * row names the skill instead of `SKILL.md`. A `SKILL.md` outside a `skills`
 * folder is an ordinary read.
 */
const skillName = (path: string | undefined): string | undefined => {
  const [folder, name, file] = (path ?? '').split(/[/\\]+/u).slice(-3);
  return file === 'SKILL.md' && folder === 'skills' && name ? name : undefined;
};

const describeAction = (command: string): ShellCommandTitle | undefined | null => {
  const action = describeShellCommand(command);
  switch (action?.kind) {
    case 'read': {
      const skill = action.paths.length === 1 ? skillName(action.paths[0]) : undefined;
      if (skill) return { action: 'useSkill', subject: skill };
      return { action: 'read', subject: action.paths.map(basename).join(', ') };
    }
    case 'search': {
      const terms = action.terms.join(', ');
      return {
        action: action.isFileNames ? 'findFiles' : 'search',
        subject: action.path ? `${terms} in ${basename(action.path)}` : terms,
      };
    }
    case 'list': {
      const path = action.path === '.' ? undefined : action.path;
      return path ? { action: 'list', subject: basename(path) } : { action: 'listFiles' };
    }
    case 'test': {
      // Go's `./...` pattern names a package tree; its last segment alone would read `...`.
      const targets = action.targets.map((target) =>
        target.endsWith('...') ? target : basename(target),
      );
      return {
        action: 'runTests',
        subject: targets.length > 0 ? targets.join(', ') : readableShellCommand(action.command),
      };
    }
    case 'commit': {
      const action_ = action.isPushed ? 'commitAndPush' : 'commit';
      return action.message
        ? { action: action_, isProse: true, subject: action.message }
        : { action: action_ };
    }
    case 'push': {
      return action.branch ? { action: 'push', subject: action.branch } : { action: 'push' };
    }
    case 'cli': {
      return action.title;
    }
    // A `gh` / `vc` / `lh` subcommand with no dedicated title reads as the command.
    case 'other': {
      return undefined;
    }
    case undefined: {
      return null;
    }
  }
};

const describe = (command: string): ShellCommandTitle | undefined => {
  const action = describeAction(command);
  if (action !== null) return action;
  const step = describeShellScript(command);
  if (!step) return undefined;
  const rest = step.rest === undefined ? undefined : describe(step.rest);
  // A file written for the command after it (an issue body for
  // `gh issue create --body-file`) is that step's input. A read, search, or
  // listing after it only checks the result, so the write stays the title.
  if (step.kind === 'write' && rest && !EXPLORE_ACTIONS.has(rest.action)) return rest;
  // Two scripts in a row (`python3 - <<'EOF'` twice) read as one.
  if (step.kind === 'script' && rest?.action === step.action) return rest;
  const then = step.rest === undefined ? undefined : `→ ${readableShellCommand(step.rest)}`;
  if (step.kind === 'write') {
    const name = basename(step.path);
    return { action: 'write', subject: then ? `${name} ${then}` : name };
  }
  if (then) return { action: step.action, subject: then };
  return step.note === undefined
    ? { action: step.action }
    : { action: step.action, isProse: true, subject: step.note };
};

/**
 * The collapsed title of a shell command that has no model-written
 * description: what it does ("读取 app.ts", "运行 Python 脚本") rather than the
 * command line. `undefined` when no action describes the command, so the row
 * keeps "执行命令 <readable command line>". The expanded row still shows the
 * exact command.
 *
 * Ported from Caxri's `describeShellRow`
 * (`packages/protocol/src/agent/tool-rows/shell/agent-shell-rows.ts`).
 */
export const describeShellCommandTitle = (rawCommand: string): ShellCommandTitle | undefined => {
  const command = getRunCommandDisplayCommand(rawCommand);
  return command ? describe(command) : undefined;
};

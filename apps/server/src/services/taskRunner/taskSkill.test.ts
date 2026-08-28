import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { builtinSkills, TaskIdentifier } from '@lobechat/builtin-skills';
import { describe, expect, it } from 'vitest';

// The vitest config stubs `.md` imports to an empty string, so read the skill
// instructions straight from disk instead of through the package export.
const builtinSkillsEntry = createRequire(import.meta.url).resolve('@lobechat/builtin-skills');
const content = readFileSync(join(dirname(builtinSkillsEntry), 'task/SKILL.md'), 'utf8');

/**
 * TaskRunnerService auto-activates the task skill for every task run, so its
 * SKILL.md lands in the system context — a higher-priority surface than the
 * per-run task prompt. Guard that the "complete when done" guidance it ships
 * carries the automation exception; without it, a quiet automation tick can
 * follow the skill and `lh task complete` its own recurring task, which
 * cancels the in-flight run and permanently disarms the heartbeat/schedule
 * loop.
 */
describe('task skill instructions', () => {
  it('is mounted under the identifier the task runner auto-activates', () => {
    expect(builtinSkills.some((s) => s.identifier === TaskIdentifier)).toBe(true);
  });

  it('ships the complete-when-done guidance the exception guards against', () => {
    expect(content).toContain('lh task complete');
    expect(content).toContain('Complete when done');
  });

  it('forbids completing automation tasks via the CLI', () => {
    expect(content).toContain('Automation tasks are the exception — NEVER complete them');
    expect(content).toContain(
      'NEVER run `lh task complete` (or set a terminal status via `lh task edit --status`)',
    );
    // The exception must follow the completion guidance it carves out of.
    expect(content.indexOf('NEVER run `lh task complete`')).toBeGreaterThan(
      content.indexOf('Complete when done'),
    );
  });
});

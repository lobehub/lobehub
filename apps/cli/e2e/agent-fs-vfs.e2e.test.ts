import { execSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

/**
 * Manual E2E coverage for `lh agent space fs` against a real backend.
 *
 * Run when:
 * - A local or remote LobeHub backend is reachable by the CLI
 * - `AGENT_FS_E2E_AGENT_ID` points at an agent with document access
 *
 * Expects:
 * - The command creates and cleans up a temporary VFS directory
 * - This suite is skipped unless `AGENT_FS_E2E_AGENT_ID` is set
 */
const AGENT_ID = process.env.AGENT_FS_E2E_AGENT_ID;
const CLI = process.env.LH_CLI_PATH || 'LOBEHUB_CLI_HOME=.lobehub-dev bun src/index.ts';
const TIMEOUT = 30_000;

function run(args: string): string {
  return execSync(`${CLI} ${args}`, {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${process.env.HOME}/.bun/bin:${process.env.PATH}` },
    timeout: TIMEOUT,
  }).trim();
}

describe.skipIf(!AGENT_ID)('lh agent space fs unified VFS - manual E2E', () => {
  const testRoot = `agent:/vfs-cli-e2e-${Date.now()}`;

  it('exercises root, mounted namespaces, writes, copy, move, trash, and cleanup', () => {
    const root = run(`agent space fs ls --agent-id ${AGENT_ID} agent:/`);
    expect(root).toContain('lobe/');

    const mountedRoot = run(`agent space fs ls --agent-id ${AGENT_ID} agent:/lobe/skills`);
    expect(mountedRoot).toContain('builtin/');
    expect(mountedRoot).toContain('agent/');

    try {
      expect(run(`agent space fs mkdir --agent-id ${AGENT_ID} --parents ${testRoot}`)).toContain(
        'created',
      );
      expect(
        run(
          `agent space fs write --agent-id ${AGENT_ID} --content "# VFS E2E" ${testRoot}/source.md`,
        ),
      ).toContain('created');
      expect(run(`agent space fs cat --agent-id ${AGENT_ID} ${testRoot}/source.md`)).toContain(
        '# VFS E2E',
      );
      expect(
        run(`agent space fs cp --agent-id ${AGENT_ID} ${testRoot}/source.md ${testRoot}/copied.md`),
      ).toContain('copied');
      expect(
        run(`agent space fs mv --agent-id ${AGENT_ID} ${testRoot}/copied.md ${testRoot}/moved.md`),
      ).toContain('moved');
      expect(run(`agent space fs rm --agent-id ${AGENT_ID} --yes ${testRoot}/moved.md`)).toContain(
        'deleted',
      );
      expect(run(`agent space fs trash ls --agent-id ${AGENT_ID} ${testRoot}`)).toContain(
        `${testRoot}/moved.md`,
      );
      expect(
        run(`agent space fs trash restore --agent-id ${AGENT_ID} ${testRoot}/moved.md`),
      ).toContain('restored');
    } finally {
      try {
        run(`agent space fs rm --agent-id ${AGENT_ID} --yes --recursive ${testRoot}`);
      } catch {
        // Cleanup is best-effort because earlier assertions may fail before creation.
      }

      try {
        run(`agent space fs trash rm --agent-id ${AGENT_ID} --yes --recursive --force ${testRoot}`);
      } catch {
        // Cleanup is best-effort because the trash entry may not exist.
      }
    }
  }, 60_000);
});

import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { assertEntriesWithinWorkspace, WORKSPACE_ESCAPE_MESSAGE } from '../workspaceGuard';

let home: string;

beforeEach(async () => {
  home = await realpath(await mkdtemp(path.join(tmpdir(), 'dc-guard-home-')));
  vi.stubEnv('HOME', home);
  vi.stubEnv('USERPROFILE', home);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(home, { force: true, recursive: true });
});

// New worktrees land in `~/.lobehub/worktrees/<repoKey>/<branch>` and become the
// conversation's working directory, so the guard must treat them like any root.
describe('assertEntriesWithinWorkspace under the central worktree root', () => {
  const relRoot = '.lobehub/worktrees/lobehub-1a2b3c4d/feat-x';

  it('allows entries inside a worktree under ~/.lobehub', async () => {
    await mkdir(path.join(home, relRoot), { recursive: true });

    for (const root of [`~/${relRoot}`, path.join(home, relRoot)]) {
      await expect(
        assertEntriesWithinWorkspace(root, [
          path.join(home, relRoot, 'src/index.ts'),
          path.join(home, relRoot, 'new/nested/file.ts'),
        ]),
      ).resolves.toBeUndefined();
    }
  });

  it('still refuses entries in a sibling worktree or elsewhere under ~/.lobehub', async () => {
    await mkdir(path.join(home, relRoot), { recursive: true });

    await expect(
      assertEntriesWithinWorkspace(`~/${relRoot}`, [
        path.join(home, '.lobehub/worktrees/lobehub-1a2b3c4d/feat-y/a.ts'),
      ]),
    ).rejects.toThrow(WORKSPACE_ESCAPE_MESSAGE);
    await expect(
      assertEntriesWithinWorkspace(`~/${relRoot}`, [path.join(home, '.lobehub/credentials.json')]),
    ).rejects.toThrow(WORKSPACE_ESCAPE_MESSAGE);
  });
});

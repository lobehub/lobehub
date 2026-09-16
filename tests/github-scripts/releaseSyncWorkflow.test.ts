// @vitest-environment node
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { parse } from 'yaml';

interface Workflow {
  jobs: Record<string, { steps: { name: string; run?: string }[] }>;
}

describe('Release branch synchronization', () => {
  it('dispatches the post-release sync on main even when the default branch is canary', async () => {
    const workflow: Workflow = parse(
      await readFile(path.resolve(process.cwd(), '.github/workflows/auto-tag-release.yml'), 'utf8'),
    );
    const step = workflow.jobs['auto-tag'].steps.find(({ name }) => name === 'Sync main to canary');

    expect(step?.run).toBeDefined();
    if (!step?.run) throw new Error('Missing post-release sync command');

    // Mock the GitHub CLI boundary: omitting --ref selects the repository default.
    const { stdout } = await promisify(execFile)('bash', [
      '-eu',
      '-c',
      `
gh() {
  test "$1" = workflow && test "$2" = run
  test "$3" = sync-main-to-canary.yaml
  shift 3
  local ref=canary
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --ref) ref="$2"; shift 2 ;;
      *) return 1 ;;
    esac
  done
  printf 'SYNC_REF=%s\\n' "$ref"
}
${step.run}
`,
    ]);

    expect(stdout).toContain('SYNC_REF=main\n');
    expect(stdout).not.toContain('SYNC_REF=canary\n');
  });
});

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const workspace = fileURLToPath(new URL('../../', import.meta.url));
const sha = 'a'.repeat(40);
const callers = [
  [
    'share overlay',
    '../actions/business-overlay/action.yml',
    'Overlay business repository',
    8,
    ['clone', 'fetch'],
  ],
  [
    'desktop overlay',
    '../actions/desktop-build-setup/action.yml',
    'Overlay Cloud repository for desktop build',
    8,
    ['clone', 'fetch'],
  ],
  [
    'core revision',
    '../workflows/release-desktop-core-ota.yml',
    'Resolve Cloud revision',
    10,
    ['ls-remote'],
  ],
];

for (const [label, file, step, indent, operations] of callers) {
  for (const failures of [0, 2, 3, 4]) {
    test(`${label}: ${failures} transient failures ${failures < 4 ? 'recover' : 'exhaust retries'}`, async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'git-retry-'));
      try {
        const source = await readFile(new URL(file, import.meta.url), 'utf8');
        const section = source.slice(source.indexOf(`- name: ${step}\n`));
        const body = section.match(new RegExp(`run: \\|\\n((?: {${indent}}.*\\n|\\n)+)`))?.[1];
        assert.ok(body, `missing Bash for ${step}`);
        const script = body.replaceAll(new RegExp(`^ {${indent}}`, 'gm'), '');
        // Fake only process boundaries; execute the shipped workflow/action Bash unchanged.
        await writeFile(
          path.join(root, 'git'),
          `#!/bin/bash
set -eu
operation=''
for arg in "$@"; do
  case "$arg" in clone|fetch|ls-remote) operation="$arg" ;; esac
done
if [ -n "$operation" ]; then
  count=0
  file="$PROBE_ROOT/$operation.attempts"
  if [ -f "$file" ]; then read -r count < "$file"; fi
  count=$((count + 1))
  echo "$count" > "$file"
  if [ "$count" -le "$FAILURES" ]; then
    echo 'remote: Repository not found.' >&2
    exit 128
  fi
fi
if [ "$operation" = ls-remote ] || [[ " $* " = *' rev-parse '* ]]; then
  printf '%s\\n' "$PROBE_SHA"
fi
`,
          { mode: 0o755 },
        );
        await writeFile(
          path.join(root, 'sleep'),
          '#!/bin/bash\nprintf "%s\\n" "$1" >> "$PROBE_ROOT/sleeps"\n',
          { mode: 0o755 },
        );
        await writeFile(path.join(root, 'node'), '#!/bin/bash\nexit 0\n', { mode: 0o755 });
        const output = path.join(root, 'output');
        const result = await exec('bash', ['-c', script], {
          cwd: root,
          env: {
            ...process.env,
            CLOUD_REF: sha,
            CLOUD_REPOSITORY: 'fixture/overlay',
            CLOUD_TOKEN: 'same-token',
            FAILURES: String(failures),
            GITHUB_ACTION_PATH: path.join(
              workspace,
              '.github/actions',
              label === 'desktop overlay' ? 'desktop-build-setup' : 'business-overlay',
            ),
            GITHUB_ENV: output,
            GITHUB_OUTPUT: output,
            GITHUB_WORKSPACE: workspace,
            OVERLAY_REF_INPUT: sha,
            OVERLAY_REPOSITORY: 'fixture/overlay',
            OVERLAY_TOKEN: 'same-token',
            PATH: `${root}:${process.env.PATH}`,
            PROBE_ROOT: root,
            PROBE_SHA: sha,
            RUNNER_TEMP: root,
          },
        }).then(
          (value) => ({ ...value, code: 0 }),
          (error) => error,
        );

        assert.equal(result.code, failures < 4 ? 0 : 128, result.stderr);
        const attempted = failures < 4 ? operations : operations.slice(0, 1);
        for (const operation of attempted) {
          assert.equal(
            Number(await readFile(path.join(root, `${operation}.attempts`), 'utf8')),
            Math.min(failures + 1, 4),
          );
        }
        const sleeps = await readFile(path.join(root, 'sleeps'), 'utf8').catch((error) => {
          if (error.code !== 'ENOENT') throw error;
          return '';
        });
        assert.deepEqual(
          sleeps.trim() ? sleeps.trim().split('\n').map(Number) : [],
          attempted.flatMap(() => [3, 10, 30].slice(0, failures)),
        );
        if (failures < 4)
          assert.match(
            await readFile(output, 'utf8'),
            new RegExp(`(?:overlay_ref|CLOUD_REF|cloud_ref)=${sha}\\n`),
          );
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
}

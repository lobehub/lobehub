import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

// Exercise the shipped Bash step, including its outputs, without network access
// or a desktop dependency install. Only the tag lookup and ABI lookup are fixtures.
const workflow = readFileSync(
  new URL('../workflows/release-desktop-core-ota.yml', import.meta.url),
  'utf8',
);
const gate = workflow.match(
  / {6}- name: Gate on shellAbi\n[\s\S]*? {8}run: \|\n((?: {10}.*\n|\n)+)/,
)?.[1];
assert.ok(gate, 'the release workflow must expose its shell ABI gate');
const script = gate.replaceAll(/^ {10}/gm, '');

const cases = [
  ['same-base canary', '2.2.19-canary.39', '2.2.19', 'stable-ahead'],
  ['same-base beta', '2.2.19-beta.1', '2.2.19', 'stable-ahead'],
  ['next-patch canary', '2.2.20-canary.1', '2.2.19', null],
  ['exact stable', '2.2.19', '2.2.19', null],
  ['older stable', '2.2.18', '2.2.19', 'stable-ahead'],
  ['newer stable', '2.2.20', '2.2.19', null],
  ['two-digit patch', '2.2.9-canary.1', '2.2.19', 'stable-ahead'],
  ['newer minor', '2.3.0-canary.1', '2.2.19', null],
  ['older major', '1.99.99', '2.2.19', 'stable-ahead'],
  ['no stable tags yet', '2.2.19-canary.1', '', null],
  ['missing shell', '', '2.2.19', 'abi-changed', { FOUND: 'false' }],
  [
    'ABI change takes precedence',
    '2.2.19-canary.1',
    '2.2.19',
    'abi-changed',
    { BASE_SHELL_ABI: 'old-abi' },
  ],
];

for (const [name, shellVersion, stableVersion, reason, overrides] of cases) {
  test(`core OTA gate: ${name}`, () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'desktop-core-gate-'));
    const output = path.join(dir, 'output');
    try {
      const result = spawnSync(
        'bash',
        [
          '-c',
          `
node() { printf '%s\\n' 'test-abi'; }
git() {
  if [ -n "$TEST_STABLE" ]; then
    printf 'abc\\trefs/tags/v%s\\n' "$TEST_STABLE"
  fi
  printf 'abc\\trefs/tags/v2.2.1\\nabc\\trefs/tags/v99.0.0-canary.1\\n' | {
    if [ -n "$TEST_STABLE" ]; then cat; else cat >/dev/null; fi
  }
}
${script}`,
        ],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            BASE_SHELL_ABI: 'test-abi',
            FOUND: 'true',
            GITHUB_OUTPUT: output,
            SHELL_VERSION: shellVersion,
            TEST_STABLE: stableVersion,
            ...overrides,
          },
        },
      );
      assert.equal(result.status, 0, result.stderr || result.stdout);
      const values = Object.fromEntries(
        readFileSync(output, 'utf8')
          .trim()
          .split('\n')
          .map((line) => line.split('=')),
      );
      assert.deepEqual(values, {
        shell_abi: 'test-abi',
        allowed: reason ? 'false' : 'true',
        requires_full_release: reason ? 'true' : 'false',
        ...(reason ? { reason } : {}),
      });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });
}

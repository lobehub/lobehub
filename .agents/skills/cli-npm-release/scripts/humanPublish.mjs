import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

import { handoffDigest, localFile, readJson, requireReady } from './record.mjs';
import { assertUnpublished } from './registry.mjs';

// Human-only entry point. Agents must never execute this file, even for a dry run.
async function main() {
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new Error(
      'Run manually in an interactive terminal; agents must not run this entry point',
    );
  const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const record = readJson(path.join(directory, 'release.json'));
  const seal = readJson(path.join(directory, 'handoff.json'));
  const validate = () => {
    requireReady(record, directory);
    if (handoffDigest(record, directory) !== seal.digest)
      throw new Error('Handoff changed; repeat preparation, do not publish');
  };
  validate();
  const attemptPath = path.join(directory, 'publish-attempt.json');
  if (existsSync(attemptPath))
    throw new Error(
      'A publication was already attempted. Ask the agent to verify registry state; do not retry blindly',
    );
  const identity = spawnSync('npm', ['whoami', `--registry=${record.registry}`], {
    stdio: 'inherit',
    timeout: 30000,
  });
  if (identity.error || identity.status !== 0) {
    throw new Error(
      `No confirmed npm identity. Run npm login --registry=${record.registry} yourself, then rerun this command. No publish was attempted`,
    );
  }
  assertUnpublished(record);
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  let answer;
  try {
    answer = await prompt.question(
      `Publish ${record.package}@${record.version} to ${record.tag}? Type ${record.version} to confirm: `,
    );
  } finally {
    prompt.close();
  }
  if (answer !== record.version) throw new Error('Cancelled; nothing published');
  assertUnpublished(record);
  validate();
  const attempt = {
    state: 'ATTEMPTED',
    startedAt: new Date().toISOString(),
    integrity: record.artifact.integrity,
  };
  writeFileSync(attemptPath, `${JSON.stringify(attempt, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  const result = spawnSync(
    'npm',
    [
      'publish',
      localFile(directory, record.artifact.path),
      '--access',
      'public',
      '--tag',
      record.tag,
      `--registry=${record.registry}`,
      '--ignore-scripts',
    ],
    { stdio: 'inherit' },
  );
  Object.assign(attempt, {
    state: !result.error && result.status === 0 ? 'SUBMITTED' : 'UNCONFIRMED',
    exitCode: result.status,
    finishedAt: new Date().toISOString(),
  });
  writeFileSync(attemptPath, `${JSON.stringify(attempt, null, 2)}\n`, { mode: 0o600 });
  console.info(
    'Publication attempt recorded. npm may process it asynchronously. Tell the agent to verify version, full integrity and tag; do not republish while visibility is pending.',
  );
  if (attempt.state !== 'SUBMITTED') process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

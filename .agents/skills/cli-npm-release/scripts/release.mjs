import { spawnSync } from 'node:child_process';
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createRecord,
  digest,
  handoffDigest,
  localFile,
  readJson,
  requireReady,
} from './record.mjs';
import { assertUnpublished, waitForPublication } from './registry.mjs';
import { collectScope } from './scope.mjs';

const scripts = path.dirname(fileURLToPath(import.meta.url));
const json = (file, value, options) =>
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, options);
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;

function runCommand(directory, label, command) {
  if (!/^[\da-z-]+$/i.test(label) || !command.length)
    throw new Error('Use a simple log label and a command after --');
  mkdirSync(path.join(directory, 'logs'), { recursive: true });
  const id = `${label}-${Date.now()}`;
  const log = `logs/${id}.log`;
  const receipt = `logs/${id}.json`;
  const fd = openSync(localFile(directory, log), 'wx', 0o600);
  let result;
  const startedAt = new Date().toISOString();
  try {
    result = spawnSync(command[0], command.slice(1), { stdio: ['ignore', fd, fd] });
  } finally {
    closeSync(fd);
  }
  const exitCode = result.error ? 1 : (result.status ?? 1);
  json(localFile(directory, receipt), {
    command,
    cwd: process.cwd(),
    startedAt,
    finishedAt: new Date().toISOString(),
    exitCode,
    signal: result.signal,
    error: result.error?.message,
    log,
  });
  console.info(JSON.stringify({ exitCode, receipt, log }));
  process.exitCode = exitCode;
}

async function main() {
  const [action, directoryArg, ...args] = process.argv.slice(2);
  if (!directoryArg)
    throw new Error(
      'Usage: release.mjs init|scope|run|pack|stamp|handoff|verify <directory> [arguments]',
    );
  const directory = path.resolve(directoryArg);
  if (action === 'init') {
    const git = spawnSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: scripts,
      encoding: 'utf8',
    });
    if (git.status !== 0) throw new Error('Cannot establish repository root');
    const root = git.stdout.trim();
    if (directory === root || directory.startsWith(`${root}${path.sep}`))
      throw new Error('Store release artifacts outside the repository');
    mkdirSync(directory, { recursive: true });
    json(path.join(directory, 'release.json'), createRecord(), { flag: 'wx', mode: 0o600 });
    console.info(
      `Initialized ${directory}; every gate is UNKNOWN. Fill release.json and report.md with inspected evidence.`,
    );
    return;
  }
  if (action === 'scope') {
    console.info(JSON.stringify(collectScope(directory, args[0]), null, 2));
    return;
  }
  if (action === 'run') {
    if (args[1] !== '--')
      throw new Error('Usage: run <release-directory> <label> -- <command> [args...]');
    runCommand(directory, args[0], args.slice(2));
    return;
  }
  const recordPath = path.join(directory, 'release.json');
  const record = readJson(recordPath);
  if (action === 'pack') {
    if (
      existsSync(path.join(directory, 'handoff.json')) ||
      existsSync(path.join(directory, 'pack.json'))
    ) {
      throw new Error(
        'Never overwrite a packed or handed-off artifact; use a new preparation directory',
      );
    }
    const manifest = readJson(path.join(process.cwd(), 'package.json'));
    if (manifest.name !== record.package || manifest.version !== record.version)
      throw new Error('Run pack from the confirmed CLI package directory');
    const result = spawnSync('npm', ['pack', '--json', '--pack-destination', directory], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
    writeFileSync(path.join(directory, 'pack-stderr.log'), result.stderr ?? '');
    json(path.join(directory, 'pack-run.json'), {
      command: ['npm', 'pack', '--json', '--pack-destination', directory],
      cwd: process.cwd(),
      exitCode: result.error ? 1 : (result.status ?? 1),
      log: 'pack-stderr.log',
    });
    if (result.error || result.status !== 0)
      throw new Error('npm pack failed; see pack-stderr.log');
    writeFileSync(path.join(directory, 'pack.json'), result.stdout, { flag: 'wx' });
    console.info(
      'Packed without publishing. Next: stamp, inspect and smoke-test; pack does not run prepublishOnly.',
    );
    return;
  }
  if (action === 'stamp') {
    if (existsSync(path.join(directory, 'handoff.json')))
      throw new Error('Already handed off; use a new preparation directory for a changed artifact');
    const packs = readJson(path.join(directory, 'pack.json'));
    if (!Array.isArray(packs) || packs.length !== 1)
      throw new Error('Expected exactly one npm pack artifact');
    const pack = packs[0];
    if (pack.name !== record.package || pack.version !== record.version)
      throw new Error('Packed package/version differs from confirmed release');
    const bytes = readFileSync(localFile(directory, pack.filename));
    const integrity = `sha512-${digest(bytes, 'sha512', 'base64')}`;
    if (integrity !== pack.integrity || pack.size !== bytes.length)
      throw new Error('npm pack metadata does not match tarball');
    record.artifact = {
      path: pack.filename,
      sha256: digest(bytes),
      integrity,
      size: bytes.length,
      node: process.version,
      platform: `${process.platform}-${process.arch}`,
    };
    json(recordPath, record);
    console.info(
      'Artifact fingerprint recorded, not approved. Inspect the archive and smoke-test this exact tarball before marking gates PASS.',
    );
    return;
  }
  if (action === 'handoff') {
    if (existsSync(path.join(directory, 'handoff.json')))
      throw new Error('Already handed off; do not overwrite its record or tools');
    requireReady(record, directory);
    if (!readFileSync(path.join(directory, 'report.md'), 'utf8').trim())
      throw new Error('Missing detailed report');
    assertUnpublished(record);
    const tools = path.join(directory, 'tools');
    mkdirSync(tools, { recursive: true });
    for (const name of ['record.mjs', 'registry.mjs', 'humanPublish.mjs'])
      copyFileSync(path.join(scripts, name), path.join(tools, name));
    json(
      path.join(directory, 'handoff.json'),
      {
        state: 'READY_FOR_HUMAN_PUBLICATION',
        preparedAt: new Date().toISOString(),
        digest: handoffDigest(record, directory),
      },
      { flag: 'wx', mode: 0o600 },
    );
    console.info(
      `${record.package}@${record.version} prepared; NOT published. Human-only next step:\nnode ${quote(path.join(tools, 'humanPublish.mjs'))}\nReport: ${path.join(directory, 'report.md')}`,
    );
    return;
  }
  if (action === 'verify') {
    requireReady(record, directory);
    const seal = readJson(path.join(directory, 'handoff.json'));
    if (seal.digest !== handoffDigest(record, directory))
      throw new Error('Handoff changed; cannot verify against a different preparation');
    mkdirSync(path.join(directory, 'verification'), { recursive: true });
    const resultPath = path.join(directory, 'verification', `${Date.now()}.json`);
    const persist = (result) =>
      json(resultPath, {
        ...result,
        version: record.version,
        tag: record.tag,
        expectedIntegrity: record.artifact.integrity,
      });
    const result = await waitForPublication(record, { onAttempt: persist });
    persist(result);
    console.info(
      `${result.state}: ${record.package}@${record.version}\nRecord: ${resultPath}\nRepository sync: ${record.repositorySync?.state ?? 'NOT_REQUESTED'} (separate from npm publication)`,
    );
    if (result.state !== 'VERIFIED') process.exitCode = 1;
    return;
  }
  throw new Error(`Unknown action: ${action}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

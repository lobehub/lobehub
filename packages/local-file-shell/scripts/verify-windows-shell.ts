/**
 * Real-Windows verification for the shell execution strategy.
 *
 * The unit tests in `__tests__/utils.test.ts` mock `process.platform` and
 * `fs.promises.lstat`, so they can run anywhere but prove nothing about the
 * actual Windows behaviour this package exists for. Three things can ONLY be
 * verified on a real Windows kernel:
 *
 * 1. Argument tokenization — Node spawns without a shell, so a plain command
 *    string is re-parsed by the Windows CRT / PowerShell parser, mangling
 *    quotes and backslashes. `-EncodedCommand` is what sidesteps that, and
 *    there is no equivalent code path on POSIX to exercise.
 * 2. Windows PowerShell 5.1 — only ships with Windows, and notably lacks the
 *    `&&` / `||` chain operators that pwsh 7 has.
 * 3. The detection cascade — resolving real `System32\WindowsPowerShell\v1.0`
 *    and `Program Files\PowerShell\7` paths instead of mocked ones.
 *
 * Deliberately dependency-free (only `node:*` + this package's own `utils.ts`)
 * so CI can run it with just bun + checkout, skipping a full monorepo install.
 *
 * Usage: bun run packages/local-file-shell/scripts/verify-windows-shell.ts
 */
import { spawn as spawnChild } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { decodeClixml } from '../src/shell/clixml';
import {
  detectWindowsShell,
  findGitBash,
  getShellConfig,
  normalizeEnvVarRefs,
} from '../src/shell/utils';

if (process.platform !== 'win32') {
  console.log('⏭  Skipped: this verification only runs on Windows.');
  process.exit(0);
}

let failed = 0;

const check = (name: string, ok: boolean, detail: string) => {
  if (!ok) failed++;
  console.log(`${ok ? '✅' : '❌'} ${name}`);
  console.log(`   ${detail}`);
};

const fileExists = async (candidate: string): Promise<boolean> => {
  try {
    await fs.lstat(candidate);
    return true;
  } catch {
    return false;
  }
};

interface SpawnResult {
  err: string;
  exit: number;
  out: string;
}

// NodeJS.ProcessEnv (not a structural Record) because app tsconfigs augment it
// with required members; every call site derives its env from process.env, and
// ProcessEnv is assignable to normalizeEnvVarRefs's structural parameter.
/** Spawn without a shell, exactly like the production runner does. */
const spawn = (cmd: string, args: string[], env: NodeJS.ProcessEnv): Promise<SpawnResult> =>
  new Promise((resolve) => {
    const child = spawnChild(cmd, args, { env, windowsHide: true });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => (err += chunk.toString('utf8')));
    child.on('error', () => resolve({ err: err.trim(), exit: -1, out: out.trim() }));
    child.on('close', (code) => resolve({ err: err.trim(), exit: code ?? -1, out: out.trim() }));
  });

// A path with spaces AND a filename with spaces — the shape that gets torn
// apart when the command string is re-tokenized.
const fixtureDir = path.join(os.tmpdir(), 'lobe shell verify');
const fixtureFile = path.join(fixtureDir, 'hello world.txt');
await fs.mkdir(fixtureDir, { recursive: true });
await fs.writeFile(fixtureFile, 'fixture-content');

const env = { ...process.env, TOKEN: 'secret value & echo pwned' };

// --- 1. Detection cascade against the real filesystem -----------------------

const shell = await detectWindowsShell();
check(
  'detects a PowerShell edition (not the cmd fallback)',
  (shell.type === 'pwsh' || shell.type === 'powershell') && (await fileExists(shell.path)),
  `type=${shell.type} path=${shell.path}`,
);

// --- 2. Quoted paths with spaces survive CRT tokenization -------------------

{
  const { args, cmd } = await getShellConfig(`Get-Content "${fixtureFile}"`);
  const r = await spawn(cmd, args, env);
  check(
    'quoted path with spaces survives argument tokenization',
    r.exit === 0 && r.out === 'fixture-content',
    `exit=${r.exit} out=${JSON.stringify(r.out)} ${r.err ? `err=${r.err}` : ''}`,
  );
}

// --- 3. Native exit codes propagate instead of collapsing to 1 --------------

{
  const { args, cmd } = await getShellConfig('cmd /c exit 42');
  const r = await spawn(cmd, args, env);
  check('native exit code 42 propagates', r.exit === 42, `exit=${r.exit} (want 42)`);
}

{
  const { args, cmd } = await getShellConfig('Get-ChildItem C:\\definitely-missing-path');
  const r = await spawn(cmd, args, env);
  check('trailing cmdlet failure exits 1', r.exit === 1, `exit=${r.exit} (want 1)`);
}

{
  // An intentionally-ignored earlier failure must not leak into the exit code.
  const { args, cmd } = await getShellConfig('cmd /c exit 7; Write-Output done');
  const r = await spawn(cmd, args, env);
  check(
    'stale $LASTEXITCODE does not override a successful final statement',
    r.exit === 0 && r.out === 'done',
    `exit=${r.exit} out=${JSON.stringify(r.out)}`,
  );
}

// --- 4. Env-var rewriting against real Windows variables --------------------

{
  // %ProgramFiles(x86)% is a genuine Windows variable whose name contains
  // parentheses and whose value contains spaces — the exact case that breaks
  // when a value is inlined instead of rewritten to ${env:VAR}.
  // Read from process.env directly: spreading it (as `env` does) drops the
  // ProcessEnv index signature, so a computed key stops type-checking.
  const expected = process.env['ProgramFiles(x86)'];
  const command = normalizeEnvVarRefs('Get-Item %ProgramFiles(x86)% | % FullName', env, shell.type);
  const { args, cmd } = await getShellConfig(command);
  const r = await spawn(cmd, args, env);
  check(
    '%ProgramFiles(x86)% rewrites to a single token',
    r.exit === 0 && !!expected && r.out === expected,
    `rewritten=${command.split('\n')[0]} exit=${r.exit} out=${JSON.stringify(r.out)} want=${JSON.stringify(expected)}`,
  );
}

{
  // The secret must reach the child through the environment, never inlined
  // into the command line where `&` would be interpreted.
  const { args, cmd } = await getShellConfig('Write-Output "[$env:TOKEN]"');
  const encoded = args.at(-1) ?? '';
  const inlined = Buffer.from(encoded, 'base64').toString('utf16le').includes('echo pwned');
  const r = await spawn(cmd, args, env);
  check(
    'secret is passed via env, never inlined into the command line',
    !inlined && r.exit === 0 && r.out === '[secret value & echo pwned]',
    `inlined=${inlined} exit=${r.exit} out=${JSON.stringify(r.out)}`,
  );
}

// --- 5. Windows PowerShell 5.1 specifically ---------------------------------

const ps51 = path.join(
  process.env.SystemRoot || 'C:\\Windows',
  'System32',
  'WindowsPowerShell',
  'v1.0',
  'powershell.exe',
);

if (await fileExists(ps51)) {
  // getShellConfig emits identical args for both editions, so the same encoded
  // payload can be replayed against 5.1 to prove it is compatible.
  const { args } = await getShellConfig(`Get-Content "${fixtureFile}"; Write-Output ok`);
  const r = await spawn(ps51, args, env);
  check(
    'Windows PowerShell 5.1 runs the same encoded payload',
    r.exit === 0 && r.out.includes('fixture-content') && r.out.includes('ok'),
    `exit=${r.exit} out=${JSON.stringify(r.out)}`,
  );

  // Guards the systemRole prompt's claim that 5.1 has no && operator. If a
  // future Windows update adds it, the prompt wording should be revisited.
  const chain = await getShellConfig('Write-Output a && Write-Output b');
  const rChain = await spawn(ps51, chain.args, env);
  check(
    "5.1 rejects '&&' (the prompt tells the model to use ';' instead)",
    rChain.exit !== 0,
    `exit=${rChain.exit} — nonzero confirms && is unsupported`,
  );
} else {
  check('Windows PowerShell 5.1 is present', false, `not found at ${ps51}`);
}

// --- 6. cmd.exe fallback ----------------------------------------------------

{
  // The cmd branch rewrites PowerShell/bash syntax to %VAR% so the value is
  // resolved by the shell instead of being pasted into the command line.
  const command = normalizeEnvVarRefs('echo [$env:TOKEN]', env, 'cmd');
  check(
    'cmd fallback rewrites $env:VAR to %VAR% without inlining the secret',
    command === 'echo [%TOKEN%]',
    `rewritten=${command}`,
  );

  // NB: no assertion on the resolved output for TOKEN. cmd expands %VAR%
  // *before* parsing the line, so a value containing `&` still splits the
  // command — an inherent cmd limitation that rewriting cannot fix, and one
  // reason cmd is only the last-resort fallback. What rewriting does buy is
  // keeping the secret out of argv (and thus out of process listings). Probe
  // actual expansion with a metacharacter-free value instead.
  const safeEnv = { ...env, LOBE_VERIFY_VALUE: 'plain-value' };
  const safe = normalizeEnvVarRefs('echo [$env:LOBE_VERIFY_VALUE]', safeEnv, 'cmd');
  const r = await spawn('cmd.exe', ['/c', safe], safeEnv);
  check(
    'cmd resolves the rewritten %VAR% at runtime',
    safe === 'echo [%LOBE_VERIFY_VALUE%]' && r.out === '[plain-value]',
    `rewritten=${safe} out=${JSON.stringify(r.out)}`,
  );
}

// --- 7. Non-ASCII output survives the OEM console code page -----------------

{
  // Without the UTF-8 encoding preamble, redirected output on a localized (or
  // CP437 CI) console writes CJK text in the OEM code page while the runner
  // reads UTF-8 — mojibake. Round-trip a CJK string through Write-Host (host
  // stream) and Write-Output (success stream) to prove both paths survive.
  const { args, cmd } = await getShellConfig('Write-Host "中文测试"; Write-Output "中文输出"');
  const r = await spawn(cmd, args, env);
  check(
    'CJK text survives redirected output (UTF-8 preamble)',
    r.exit === 0 && `${r.out}\n${r.err}`.includes('中文') && r.out.includes('中文输出'),
    `exit=${r.exit} out=${JSON.stringify(r.out)} err=${JSON.stringify(r.err)}`,
  );
}

// --- 8. CLIXML on redirected stderr decodes to readable text ----------------

{
  // When stderr is redirected, PowerShell serializes non-stdout streams as
  // CLIXML. decodeClixml (applied by the process manager before returning
  // output) must recover the human-readable message.
  const { args, cmd } = await getShellConfig('Write-Error "clixml-probe"; Write-Output done');
  const r = await spawn(cmd, args, env);
  const decoded = decodeClixml(r.err);
  check(
    'CLIXML stderr decodes back to the original message',
    r.err.length === 0 || (decoded.includes('clixml-probe') && !decoded.includes('<Objs')),
    `rawErr=${JSON.stringify(r.err.slice(0, 120))} decoded=${JSON.stringify(decoded.slice(0, 120))}`,
  );
}

// --- 9. Git Bash env-var rewriting survives MSYS2 name upper-casing ---------

{
  // MSYS2 imports some Windows variables with upper-cased names (ProgramFiles
  // → PROGRAMFILES inside bash), so the rewritten reference must resolve
  // regardless of which spelling bash ends up with. Only runnable when Git
  // Bash is actually installed (it is on GitHub windows runners).
  const gitBash = await findGitBash();
  if (gitBash) {
    const expected = process.env.ProgramFiles;
    const command = normalizeEnvVarRefs('echo "%ProgramFiles%"', env, 'gitbash');
    const r = await spawn(gitBash, ['-c', command], env);
    check(
      'Git Bash resolves rewritten %ProgramFiles% despite MSYS2 upper-casing',
      r.exit === 0 && !!expected && r.out === expected,
      `rewritten=${command} exit=${r.exit} out=${JSON.stringify(r.out)} want=${JSON.stringify(expected)}`,
    );
  } else {
    console.log('⏭  Git Bash not installed — skipping MSYS2 env-var check.');
  }
}

await fs.rm(fixtureDir, { force: true, recursive: true });

console.log(`\n${failed === 0 ? 'All checks passed' : `${failed} check(s) failed`}`);
process.exit(failed === 0 ? 0 : 1);

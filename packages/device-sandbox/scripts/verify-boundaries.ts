import { spawn } from 'node:child_process';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { createSandboxLaunchPlan, srtSandboxRuntime } from '../src';

interface CommandResult {
  exitCode: number | null;
  stderr: string;
  stdout: string;
}

interface VerificationCase {
  actual: string;
  expected: string;
  name: string;
  passed: boolean;
}

const execute = async (command: string, writableRoots: string[]): Promise<CommandResult> => {
  const launchPlan = await createSandboxLaunchPlan({
    command: { args: ['-c', command], cmd: '/bin/sh' },
    env: { ...process.env, LOBE_TEST_SECRET: 'must-not-leak' },
    policy: { allowNetwork: false, onUnavailable: 'deny', writableRoots },
  });

  return new Promise((resolve, reject) => {
    const child = spawn(launchPlan.cmd, launchPlan.args, {
      env: launchPlan.env as NodeJS.ProcessEnv,
    });
    let stderr = '';
    let stdout = '';
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.once('error', (error) => {
      launchPlan.release?.();
      reject(error);
    });
    child.once('close', (exitCode) => {
      launchPlan.release?.();
      resolve({ exitCode, stderr, stdout });
    });
  });
};

const printCase = ({ actual, expected, name, passed }: VerificationCase) => {
  console.log(`\n[${passed ? 'PASS' : 'FAIL'}] ${name}`);
  console.log(`  预期: ${expected}`);
  console.log(`  实际: ${actual}`);
};

const fileExists = async (filePath: string) => {
  try {
    await import('node:fs/promises').then(({ access }) => access(filePath));
    return true;
  } catch {
    return false;
  }
};

const main = async () => {
  if (process.platform !== 'darwin') {
    throw new Error('This evidence runner currently requires macOS Seatbelt');
  }

  const allowedRoot = await mkdtemp(path.join(os.tmpdir(), 'device-evidence-allowed-'));
  const deniedRoot = await mkdtemp(path.join(os.tmpdir(), 'device-evidence-denied-'));
  const cases: VerificationCase[] = [];

  console.log('Device Sandbox 可读验证证据');
  console.log(`平台: ${process.platform} ${process.arch}`);
  console.log('backend: @anthropic-ai/sandbox-runtime (macOS Seatbelt)');
  console.log(`授权目录: ${allowedRoot}`);
  console.log(`未授权目录: ${deniedRoot}`);

  try {
    const allowedTarget = path.join(allowedRoot, 'allowed.txt');
    const allowed = await execute(`printf allowed > ${JSON.stringify(allowedTarget)}`, [
      allowedRoot,
    ]);
    const allowedExists = await fileExists(allowedTarget);
    cases.push({
      actual: `exit=${allowed.exitCode}; fileExists=${allowedExists}; stderr=${JSON.stringify(allowed.stderr.trim())}`,
      expected: 'exit=0 且文件真实存在',
      name: '控制组：写入授权目录',
      passed: allowed.exitCode === 0 && allowedExists,
    });

    const absoluteTarget = path.join(deniedRoot, 'absolute.txt');
    const absolute = await execute(`printf denied > ${JSON.stringify(absoluteTarget)}`, [
      allowedRoot,
    ]);
    const absoluteExists = await fileExists(absoluteTarget);
    cases.push({
      actual: `exit=${absolute.exitCode}; fileExists=${absoluteExists}; stderr=${JSON.stringify(absolute.stderr.trim())}`,
      expected: '非零退出码、Operation not permitted、文件不存在',
      name: '攻击 1：使用绝对路径写入未授权目录',
      passed:
        absolute.exitCode !== 0 &&
        !absoluteExists &&
        absolute.stderr.includes('Operation not permitted'),
    });

    const traversalTarget = path.join(
      allowedRoot,
      '..',
      path.basename(deniedRoot),
      'traversal.txt',
    );
    const traversal = await execute(`printf denied > ${JSON.stringify(traversalTarget)}`, [
      allowedRoot,
    ]);
    const traversalExists = await fileExists(traversalTarget);
    cases.push({
      actual: `exit=${traversal.exitCode}; fileExists=${traversalExists}; stderr=${JSON.stringify(traversal.stderr.trim())}`,
      expected: '非零退出码、Operation not permitted、文件不存在',
      name: '攻击 2：使用 ../ 穿越到未授权目录',
      passed:
        traversal.exitCode !== 0 &&
        !traversalExists &&
        traversal.stderr.includes('Operation not permitted'),
    });

    const childTarget = path.join(deniedRoot, 'child-shell.txt');
    const child = await execute(`/bin/sh -c 'printf denied > ${JSON.stringify(childTarget)}'`, [
      allowedRoot,
    ]);
    const childExists = await fileExists(childTarget);
    cases.push({
      actual: `exit=${child.exitCode}; fileExists=${childExists}; stderr=${JSON.stringify(child.stderr.trim())}`,
      expected: '子 shell 同样被约束，文件不存在',
      name: '攻击 3：启动子 shell 后重定向写入',
      passed:
        child.exitCode !== 0 && !childExists && child.stderr.includes('Operation not permitted'),
    });

    const outsideLink = path.join(allowedRoot, 'outside-link');
    await symlink(deniedRoot, outsideLink);
    const linkedTarget = path.join(outsideLink, 'linked.txt');
    const linked = await execute(`printf denied > ${JSON.stringify(linkedTarget)}`, [allowedRoot]);
    const linkedExists = await fileExists(linkedTarget);
    cases.push({
      actual: `exit=${linked.exitCode}; fileExists=${linkedExists}; stderr=${JSON.stringify(linked.stderr.trim())}`,
      expected: '按 symlink 的真实目标判定，文件不存在',
      name: '攻击 4：通过授权目录内的 symlink 写到目录外',
      passed:
        linked.exitCode !== 0 && !linkedExists && linked.stderr.includes('Operation not permitted'),
    });

    const secret = await execute('printf %s "${LOBE_TEST_SECRET-unset}"', [allowedRoot]);
    cases.push({
      actual: `exit=${secret.exitCode}; stdout=${JSON.stringify(secret.stdout)}; leaked=${secret.stdout.includes('must-not-leak')}`,
      expected: 'stdout="unset" 且 leaked=false',
      name: '凭证攻击：读取未加入 allowlist 的宿主环境变量',
      passed:
        secret.exitCode === 0 &&
        secret.stdout === 'unset' &&
        !secret.stdout.includes('must-not-leak'),
    });

    let acceptedConnections = 0;
    const server = createServer(() => {
      acceptedConnections += 1;
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Failed to bind evidence server');

    try {
      const network = await execute(
        `node -e "require('net').connect(${address.port}, '127.0.0.1').once('connect', () => process.exit(0)).once('error', (error) => { console.error(error.code); process.exit(7) })"`,
        [allowedRoot],
      );
      cases.push({
        actual: `exit=${network.exitCode}; hostAcceptedConnections=${acceptedConnections}; stderr=${JSON.stringify(network.stderr.trim())}`,
        expected: '连接失败，宿主 server 接收到 0 个连接',
        name: '网络攻击：绕过应用直接连接 127.0.0.1 TCP server',
        passed: network.exitCode !== 0 && acceptedConnections === 0,
      });
    } finally {
      server.close();
    }

    for (const item of cases) printCase(item);

    const passed = cases.filter((item) => item.passed).length;
    console.log(`\n结论: ${passed}/${cases.length} 项符合预期`);
    console.log('说明: 这些结果来自本次真实进程执行，不是对测试代码的静态推断。');
    if (passed !== cases.length) process.exitCode = 1;
  } finally {
    await srtSandboxRuntime.shutdown();
    await Promise.all([
      rm(allowedRoot, { force: true, recursive: true }),
      rm(deniedRoot, { force: true, recursive: true }),
    ]);
  }
};

await main();

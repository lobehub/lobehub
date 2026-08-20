import type { Command } from 'commander';
import pc from 'picocolors';

import { CLI_PRIMARY_BIN } from '../constants/identity';
import { probeSandbox, resetSandboxCapabilityCache } from '../tools/shell';
import { applySandboxHostPaths, bundledSrtWinPath } from '../tools/srtWin';
import { log } from '../utils/logger';

export function registerSandboxCommand(program: Command) {
  const sandboxCmd = program
    .command('sandbox')
    .description('Inspect and provision this device’s command sandbox');

  sandboxCmd
    .command('status', { isDefault: true })
    .description('Report whether this device can run sandboxed commands')
    .action(async () => {
      const capability = await probeSandbox();

      console.log(pc.bold('Sandbox'));
      console.log(`  available   ${capability.available}`);
      if (capability.reason) console.log(`  reason      ${capability.reason}`);

      const helper = bundledSrtWinPath();
      if (helper) console.log(`  helper      ${pc.dim(helper)}`);

      if (!capability.available && process.platform === 'win32') {
        console.log();
        console.log(`  Run '${CLI_PRIMARY_BIN} sandbox install' to provision it.`);
      }
    });

  sandboxCmd
    .command('install')
    .description('Provision the sandbox backend on this machine (Windows: one UAC prompt)')
    .action(async () => {
      // Same override the probe applies, for the same reason: setup resolves
      // and stages the helper itself, so it has to look where this build put
      // it rather than where the backend's package would have been.
      applySandboxHostPaths();

      const { installDeviceSandbox } = await import('@lobechat/device-sandbox');
      const result = await installDeviceSandbox();

      if (result.status === 'cancelled') {
        // Dismissing the elevation prompt is an answer, not a failure.
        log.info('Setup cancelled.');
        return;
      }

      if (result.status === 'not-installable') {
        log.error(result.instructions ?? 'This platform has no automatic sandbox setup.');
        process.exitCode = 1;
        return;
      }

      // The probe memoises per process, and setup just changed the answer.
      resetSandboxCapabilityCache();
      const capability = await probeSandbox();

      if (!capability.available) {
        log.error(
          `Setup reported success but the sandbox is still unavailable: ${capability.reason ?? 'unknown reason'}`,
        );
        process.exitCode = 1;
        return;
      }

      log.info('Sandbox is ready on this device.');
    });
}

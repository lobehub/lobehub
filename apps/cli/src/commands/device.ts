import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../api/client';
import { confirm, outputJson, printTable, timeAgo } from '../utils/format';
import { log } from '../utils/logger';

export function registerDeviceCommand(program: Command) {
  const device = program.command('device').description('Manage connected devices');

  // ── list ──────────────────────────────────────────────

  device
    .command('list')
    .description('List all online devices')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(async (options: { json?: string | boolean }) => {
      const client = await getTrpcClient();
      const devices = await client.device.listDevices.query();

      if (options.json !== undefined) {
        const fields = typeof options.json === 'string' ? options.json : undefined;
        outputJson(devices, fields);
        return;
      }

      if (devices.length === 0) {
        console.log('No online devices found.');
        console.log(pc.dim("Use 'lh connect' to connect this device."));
        return;
      }

      const rows = devices.map((d: any) => [
        d.deviceId || '',
        d.hostname || '',
        d.platform || '',
        d.online ? pc.green('online') : pc.dim('offline'),
        d.lastSeen ? timeAgo(d.lastSeen) : '',
      ]);

      printTable(rows, ['DEVICE ID', 'HOSTNAME', 'PLATFORM', 'STATUS', 'CONNECTED']);
    });

  // ── info ──────────────────────────────────────────────

  device
    .command('info <deviceId>')
    .description('Show system info of a specific device')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(async (deviceId: string, options: { json?: string | boolean }) => {
      const client = await getTrpcClient();
      const info = await client.device.getDeviceSystemInfo.query({ deviceId });

      if (!info) {
        log.error(`Device "${deviceId}" is not reachable or does not exist.`);
        process.exit(1);
        return;
      }

      if (options.json !== undefined) {
        const fields = typeof options.json === 'string' ? options.json : undefined;
        outputJson(info, fields);
        return;
      }

      console.log(pc.bold('Device System Info'));
      console.log(`  Architecture       : ${info.arch}`);
      console.log(`  Working Directory  : ${info.workingDirectory}`);
      console.log(`  Home               : ${info.homePath}`);
      console.log(`  Desktop            : ${info.desktopPath}`);
      console.log(`  Documents          : ${info.documentsPath}`);
      console.log(`  Downloads          : ${info.downloadsPath}`);
      console.log(`  Music              : ${info.musicPath}`);
      console.log(`  Pictures           : ${info.picturesPath}`);
      console.log(`  Videos             : ${info.videosPath}`);
    });

  // ── delete ────────────────────────────────────────────

  device
    .command('delete <deviceId...>')
    .alias('remove')
    .description('Remove one or more devices from your account')
    .option('--yes', 'Skip confirmation prompt')
    .action(async (deviceIds: string[], options: { yes?: boolean }) => {
      if (!options.yes) {
        const label =
          deviceIds.length === 1 ? `device "${deviceIds[0]}"` : `${deviceIds.length} devices`;
        const confirmed = await confirm(`Are you sure you want to remove ${label}?`);
        if (!confirmed) {
          console.log('Cancelled.');
          return;
        }
      }

      const client = await getTrpcClient();

      // Resolve each device's scope first: workspace devices are owner-gated and
      // live in a separate pool, so they need `removeWorkspaceDevice`, not the
      // personal `removeDevice`. Routing blindly through the personal path would
      // no-op on a workspace device yet still print success. `listDevices`
      // already returns both pools (only when a workspace context is set).
      const devices = await client.device.listDevices.query();
      const byId = new Map(devices.map((d: any) => [d.deviceId, d]));

      let failed = 0;
      for (const deviceId of deviceIds) {
        const device = byId.get(deviceId);
        if (!device) {
          failed += 1;
          log.error(
            `Device "${deviceId}" was not found. Run 'lh device list' to see available devices.`,
          );
          continue;
        }
        try {
          if (device.scope === 'workspace') {
            await client.device.removeWorkspaceDevice.mutate({ deviceId });
          } else {
            await client.device.removeDevice.mutate({ deviceId });
          }
          console.log(`${pc.green('✓')} Removed device ${pc.bold(deviceId)}`);
        } catch (e) {
          failed += 1;
          log.error(`Failed to remove "${deviceId}": ${(e as Error).message}`);
        }
      }

      if (failed > 0) process.exit(1);
    });

  // ── status ────────────────────────────────────────────

  device
    .command('status')
    .description('Show device connection overview')
    .option('--json', 'Output JSON')
    .action(async (options: { json?: boolean }) => {
      const client = await getTrpcClient();
      const status = await client.device.status.query();

      if (options.json) {
        outputJson(status);
        return;
      }

      console.log(pc.bold('Device Status'));
      console.log(`  Online   : ${status.online ? pc.green('yes') : pc.dim('no')}`);
      console.log(`  Devices  : ${status.deviceCount}`);
    });
}

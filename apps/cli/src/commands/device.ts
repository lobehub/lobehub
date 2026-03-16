import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../api/client';
import { outputJson, printTable, timeAgo } from '../utils/format';
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

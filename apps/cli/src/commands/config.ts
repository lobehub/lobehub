import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../api/client';
import { outputJson } from '../utils/format';

export function registerConfigCommand(program: Command) {
  // ── whoami ────────────────────────────────────────────

  program
    .command('whoami')
    .description('Display current user information')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(async (options: { json?: string | boolean }) => {
      const client = await getTrpcClient();
      const state = await client.user.getUserState.query();

      if (options.json !== undefined) {
        const fields = typeof options.json === 'string' ? options.json : undefined;
        outputJson(state, fields);
        return;
      }

      const s = state as any;
      console.log(pc.bold('User Info'));
      if (s.fullName || s.firstName) console.log(`  Name:     ${s.fullName || s.firstName}`);
      if (s.username) console.log(`  Username: ${s.username}`);
      if (s.email) console.log(`  Email:    ${s.email}`);
      if (s.userId) console.log(`  User ID:  ${s.userId}`);
      if (s.subscriptionPlan) console.log(`  Plan:     ${s.subscriptionPlan}`);
    });

  // ── usage ─────────────────────────────────────────────

  program
    .command('usage')
    .description('View usage statistics')
    .option('--month <YYYY-MM>', 'Month to query (default: current)')
    .option('--daily', 'Group by day')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(async (options: { daily?: boolean; json?: string | boolean; month?: string }) => {
      const client = await getTrpcClient();

      const input: { mo?: string } = {};
      if (options.month) input.mo = options.month;

      let result: any;
      if (options.daily) {
        result = await client.usage.findAndGroupByDay.query(input);
      } else {
        result = await client.usage.findByMonth.query(input);
      }

      if (options.json !== undefined) {
        const fields = typeof options.json === 'string' ? options.json : undefined;
        outputJson(result, fields);
        return;
      }

      if (!result) {
        console.log('No usage data available.');
        return;
      }

      if (options.daily && Array.isArray(result)) {
        console.log(pc.bold('Daily Usage'));
        for (const entry of result) {
          const e = entry as any;
          const day = e.date || e.day || '';
          const tokens = e.totalTokens || e.tokens || 0;
          console.log(`  ${day}: ${tokens} tokens`);
        }
      } else {
        console.log(pc.bold('Monthly Usage'));
        console.log(JSON.stringify(result, null, 2));
      }
    });
}

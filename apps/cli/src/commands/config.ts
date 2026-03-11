import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../api/client';
import {
  type BoxTableRow,
  formatCost,
  formatNumber,
  outputJson,
  printBoxTable,
  printCalendarHeatmap,
} from '../utils/format';

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

      if (options.json !== undefined) {
        let jsonResult: any;
        if (options.daily) {
          jsonResult = await client.usage.findAndGroupByDay.query(input);
        } else {
          jsonResult = await client.usage.findByMonth.query(input);
        }
        const fields = typeof options.json === 'string' ? options.json : undefined;
        outputJson(jsonResult, fields);
        return;
      }

      // Always fetch daily-grouped data for table display
      const result: any = await client.usage.findAndGroupByDay.query(input);

      if (!result) {
        console.log('No usage data available.');
        return;
      }

      // Normalize result to an array of daily logs
      const logs: any[] = Array.isArray(result) ? result : [result];

      // Filter out days with zero activity for cleaner output
      const activeLogs = logs.filter(
        (l: any) => (l.totalTokens || 0) > 0 || (l.totalRequests || 0) > 0,
      );

      if (activeLogs.length === 0) {
        console.log('No usage data available.');
        return;
      }

      // Build table columns
      const columns = [
        { align: 'left' as const, header: 'Date', key: 'date' },
        { align: 'left' as const, header: 'Models', key: 'models' },
        { align: 'right' as const, header: 'Input', key: 'input' },
        { align: 'right' as const, header: 'Output', key: 'output' },
        { align: 'right' as const, header: ['Total', 'Tokens'], key: 'total' },
        { align: 'right' as const, header: 'Requests', key: 'requests' },
        { align: 'right' as const, header: ['Cost', '(USD)'], key: 'cost' },
      ];

      // Totals
      let sumInput = 0;
      let sumOutput = 0;
      let sumTotal = 0;
      let sumRequests = 0;
      let sumCost = 0;

      const rows: BoxTableRow[] = activeLogs.map((log: any) => {
        const records: any[] = log.records || [];

        // Aggregate tokens
        let inputTokens = 0;
        let outputTokens = 0;
        for (const r of records) {
          inputTokens += r.totalInputTokens || 0;
          outputTokens += r.totalOutputTokens || 0;
        }
        const totalTokens = log.totalTokens || inputTokens + outputTokens;
        const cost = log.totalSpend || 0;
        const requests = log.totalRequests || 0;

        sumInput += inputTokens;
        sumOutput += outputTokens;
        sumTotal += totalTokens;
        sumRequests += requests;
        sumCost += cost;

        // Unique models
        const modelSet = new Set<string>();
        for (const r of records) {
          if (r.model) modelSet.add(r.model);
        }
        const modelList = [...modelSet].sort().map((m) => `- ${m}`);

        return {
          cost: formatCost(cost),
          date: log.day || '',
          input: formatNumber(inputTokens),
          models: modelList.length > 0 ? modelList : ['-'],
          output: formatNumber(outputTokens),
          requests: formatNumber(requests),
          total: formatNumber(totalTokens),
        };
      });

      // Total row
      rows.push({
        cost: pc.bold(formatCost(sumCost)),
        date: pc.bold('Total'),
        input: pc.bold(formatNumber(sumInput)),
        models: '',
        output: pc.bold(formatNumber(sumOutput)),
        requests: pc.bold(formatNumber(sumRequests)),
        total: pc.bold(formatNumber(sumTotal)),
      });

      const monthLabel = options.month || new Date().toISOString().slice(0, 7);
      const mode = options.daily ? 'Daily' : 'Monthly';
      printBoxTable(columns, rows, `LobeHub Token Usage Report - ${mode} (${monthLabel})`);

      // Calendar heatmap - fetch past 12 months
      const now = new Date();
      const rangeStart = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate() + 1);
      let yearLogs: any[];

      try {
        // Try single-request endpoint first
        yearLogs = await client.usage.findAndGroupByDateRange.query({
          endAt: now.toISOString().slice(0, 10),
          startAt: rangeStart.toISOString().slice(0, 10),
        });
      } catch {
        // Fallback: fetch each month concurrently
        const monthKeys: string[] = [];
        for (let i = 11; i >= 0; i--) {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
          monthKeys.push(d.toISOString().slice(0, 7));
        }
        const results = await Promise.all(
          monthKeys.map((mo) => client.usage.findAndGroupByDay.query({ mo })),
        );
        yearLogs = results.flat();
      }

      const calendarData = (Array.isArray(yearLogs) ? yearLogs : [])
        .filter((log: any) => log.day)
        .map((log: any) => ({
          day: log.day,
          value: log.totalTokens || 0,
        }));

      const yearTotal = calendarData.reduce((acc: number, d: any) => acc + d.value, 0);

      printCalendarHeatmap(calendarData, {
        label: `Past 12 months: ${formatNumber(yearTotal)} tokens`,
        title: 'Activity (past 12 months)',
      });
    });
}

import type { Command } from 'commander';

import { ALL_CHECKS, exitCodeFor, renderReport, runDoctor } from '../doctor';
import type { DoctorOptions, DoctorProfile } from '../doctor/types';
import { DOCTOR_PROFILES } from '../doctor/types';
import { outputJson } from '../utils/format';
import { log, setVerbose } from '../utils/logger';

interface DoctorCommandOptions {
  agent?: string;
  deep?: boolean;
  fix?: boolean;
  hetero?: string;
  json?: string | boolean;
  offline?: boolean;
  profile?: string;
  strict?: boolean;
  timeout?: string;
  verbose?: boolean;
}

export function registerDoctorCommand(program: Command) {
  program
    .command('doctor')
    .description(
      'Diagnose this machine: runtime, endpoints, credentials, scope, device and agent readiness',
    )
    .option('--profile <name>', `Which layers to check (${DOCTOR_PROFILES.join(', ')})`, 'core')
    .option('--json [fields]', 'Output the report as JSON, optionally picking fields')
    .option('--offline', 'Skip every check that would touch the network')
    .option('--deep', 'Include the slow, costly checks (starts a real agent run)')
    .option('--fix', 'Apply the repairs the failing checks know how to apply')
    .option('--strict', 'Exit non-zero on warnings too')
    .option('--agent <idOrSlug>', 'Agent to check execution readiness against')
    .option(
      '--hetero <types>',
      'Comma-separated external agent types to probe (e.g. claude-code,codex)',
    )
    .option('--timeout <ms>', 'Per-check budget for anything on the network', '10000')
    .option('-v, --verbose', 'Show the evidence behind each check')
    .action(async (options: DoctorCommandOptions) => {
      if (options.verbose) setVerbose(true);

      const profile = (options.profile ?? 'core') as DoctorProfile;
      if (!DOCTOR_PROFILES.includes(profile)) {
        log.error(`Unknown profile "${profile}". Use one of: ${DOCTOR_PROFILES.join(', ')}.`);
        process.exit(1);
        return;
      }

      const parsedTimeout = Number.parseInt(options.timeout ?? '10000', 10);
      const doctorOptions: DoctorOptions = {
        agent: options.agent,
        deep: Boolean(options.deep),
        fix: Boolean(options.fix),
        hetero: options.hetero
          ?.split(',')
          .map((type) => type.trim())
          .filter(Boolean),
        offline: Boolean(options.offline),
        profile,
        strict: Boolean(options.strict),
        timeoutMs: Number.isFinite(parsedTimeout) && parsedTimeout > 0 ? parsedTimeout : 10_000,
      };

      const report = await runDoctor(ALL_CHECKS, doctorOptions);

      if (options.json !== undefined) {
        outputJson(report, typeof options.json === 'string' ? options.json : undefined);
      } else {
        console.log(renderReport(report, { verbose: options.verbose }));
      }

      // Exit once stdout has drained, not before and not whenever the event loop
      // happens to empty. `process.exit()` right after a large write truncates a
      // piped JSON report; waiting for the loop instead lets a request abandoned
      // by a check timeout (a stalled token refresh, a trickling response) keep
      // the process alive long after the report is done. A write callback fires
      // only after everything queued before it has been flushed.
      const code = exitCodeFor(report, doctorOptions.strict);
      process.stdout.write('', () => process.exit(code));
    });
}

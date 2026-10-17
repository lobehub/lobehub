import type { Command } from 'commander';

import { log } from '../../utils/logger';
import { attachCriterionCommands } from './criterion';
import { registerAcceptanceCommands } from './index';
import { attachPlanCommands, attachPlanExecuteCommand } from './plan';
import { attachRubricCommands } from './rubric';
import { attachDeprecatedVerifyRunAliases } from './run';

/** Warn before any command of a group that moved under `lh acceptance` runs. */
const deprecateGroup = (group: Command, replacement: string): Command =>
  group.hook('preAction', (_group, action) => {
    // The subcommand path below the group, e.g. `state` for `verify plan state`.
    const rest: string[] = [];
    for (let cmd: Command | null = action; cmd && cmd !== group; cmd = cmd.parent)
      rest.unshift(cmd.name());
    const suffix = rest.length > 0 ? ` ${rest.join(' ')}` : '';
    log.warn(
      `\`lh verify ${group.name()}${suffix}\` is deprecated — use \`${replacement}${suffix}\` (removed in a future release)`,
    );
  });

/**
 * The pre-move `lh verify …` command surface. Every command now lives under
 * `lh acceptance`; these aliases wire the same implementations and warn, and
 * are scheduled for removal once callers migrate.
 */
export function registerVerifyCommand(program: Command) {
  const verify = program.command('verify').description('Deprecated — use `lh acceptance`');

  // `verify acceptance …` — legacy alias of the first-class `lh acceptance`.
  registerAcceptanceCommands(verify, { deprecated: true });
  attachDeprecatedVerifyRunAliases(verify);

  deprecateGroup(attachCriterionCommands(verify), 'lh acceptance criterion');
  deprecateGroup(attachRubricCommands(verify), 'lh acceptance rubric');
  deprecateGroup(attachPlanCommands(verify), 'lh acceptance plan');
  deprecateGroup(
    attachPlanExecuteCommand(verify.command('execute <operationId>')),
    'lh acceptance plan execute',
  );
}

import type { LobeChatDatabase } from '@lobechat/database';
import debug from 'debug';

import { appEnv } from '@/envs/app';

import { listEnabledRulesForTarget } from './rulesRepository';
import type {
  CommandGovernanceContext,
  CommandGovernanceDecision,
  CommandGovernancePatternType,
} from './types';

const log = debug('lobe-server:governance:policy-gate');

/**
 * The tool-result message shown to the model when `checkCommand` denies a
 * command. Every chokepoint that surfaces a `COMMAND_BLOCKED` result
 * (`toolExecution/builtin.ts`, `sandbox/service.ts`) must use this exact
 * string rather than writing its own — a model that sees a bare "this was
 * blocked" has been observed retrying the same command, or a slightly
 * reworded one, believing a different phrasing might get through. The
 * message is deliberately explicit about stopping rather than trusting the
 * model to infer it: it is not a transient failure to work around, it is a
 * standing policy decision that will deny the same command (and any
 * equivalent) again.
 */
export const COMMAND_BLOCKED_MESSAGE =
  'This command was blocked by an administrator-configured command governance rule for this ' +
  'user. This is a policy decision, not a transient error — retrying the same command, a ' +
  'reworded version of it, or an alternative command that achieves the same effect will be ' +
  'blocked again. Do not attempt this action again in any form. Stop this line of action now ' +
  "and tell the user the command was blocked by their administrator's policy.";

/**
 * Master switch. Every governance code path (the `builtin.ts` chokepoint AND
 * the `/api/governance/check` + `/api/governance/log` HTTP handlers) must
 * call this FIRST and short-circuit on `false` — the product requirement is
 * zero DB/network calls when the feature is off, not "cheap" calls.
 */
export const isGovernanceEnabled = (): boolean => appEnv.COMMAND_GOVERNANCE_ENABLED === true;

const matchesRule = (
  commandText: string,
  pattern: string,
  patternType: CommandGovernancePatternType,
): boolean => {
  switch (patternType) {
    case 'exact': {
      return commandText === pattern;
    }
    case 'prefix': {
      return commandText.startsWith(pattern);
    }
    case 'regex': {
      try {
        return new RegExp(pattern).test(commandText);
      } catch (error) {
        // A malformed regex authored by an admin must not brick command
        // execution for the user it targets — skip it (and let the fail-open
        // path below cover any other unexpected error).
        log('Invalid regex pattern %o for rule evaluation: %O', pattern, error);
        return false;
      }
    }
  }
};

/**
 * Evaluate whether `ctx.commandText` is allowed to run.
 *
 * FAIL-OPEN BY DESIGN: any internal error (DB unreachable, malformed row,
 * etc.) is logged and treated as `{ allowed: true }`. Command governance is a
 * defense-in-depth control, not the user's only safety net, and the product
 * decision here is that a governance-system outage must never itself take
 * down command execution. Revisit this if the threat model changes (e.g. if
 * governance becomes the *sole* enforcement point for a compliance
 * requirement, this should fail CLOSED instead).
 */
export const checkCommand = async (
  ctx: CommandGovernanceContext,
  db: LobeChatDatabase,
): Promise<CommandGovernanceDecision> => {
  if (!isGovernanceEnabled()) return { allowed: true };

  try {
    const rules = await listEnabledRulesForTarget(db, ctx.userId, ctx.executionTarget);

    for (const rule of rules) {
      if (
        matchesRule(ctx.commandText, rule.pattern, rule.patternType as CommandGovernancePatternType)
      ) {
        log(
          'Denying command for user %s (rule %s, target %s): %s',
          ctx.userId,
          rule.id,
          ctx.executionTarget,
          ctx.commandText,
        );
        return { allowed: false, ruleId: rule.id };
      }
    }

    return { allowed: true };
  } catch (error) {
    console.error('[governance] checkCommand failed, failing open (allowed=true): %O', error);
    return { allowed: true };
  }
};

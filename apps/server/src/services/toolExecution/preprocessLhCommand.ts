import { OFFICIAL_URL } from '@lobechat/const';
import debug from 'debug';

import { appEnv } from '@/envs/app';
import { signUserJWT } from '@/libs/trpc/utils/internalJwt';
import { isDev } from '@/utils/env';

const log = debug('lobe-server:lh-command');

export interface PreprocessResult {
  command: string;
  error?: string;
  isLhCommand: boolean;
  skipSkillLookup: boolean;
}

/**
 * `lh` in shell **command position**. Matches at the start of the script or
 * right after a separator / opening construct, allowing inline `VAR=value`
 * assignments in between (`FOO=1 lh agent list`).
 *
 * Command-position openers covered: newline, `;`, `&` (also the second `&` of
 * `&&`), `|` (also `||`), `(` (also the `(` of `$(`), `)` (a `case` arm), a
 * backtick, `{`, and the compound-command keywords. That set is what makes
 * multi-line scripts, pipelines, command substitution, subshells, loops and
 * `case` statements resolve — the previous pattern only knew `^`, `&&`, `||`
 * and `;` on a single line, so everything after the first line of a `view` →
 * `edit` script fell through unhandled.
 *
 * Between the opener and `lh` the pattern also allows the `!` and `time`
 * prefixes (`if ! lh whoami; then …`, `time lh agent list`) and inline
 * `VAR=value` assignments. `!` and `time` are the only command prefixes worth
 * matching: they are shell reserved words, so the shell still resolves `lh`
 * through the injected function. Prefixes that fork an external command —
 * `env`, `nohup`, `xargs`, and POSIX `command` / `exec`, which bypass function
 * lookup by definition — could never see a shell function anyway, so matching
 * them would inject a shim that cannot help.
 *
 * This is a DETECTION-only heuristic: the command itself is never rewritten
 * (see `preprocessLhCommand`), so a false positive costs one harmless shim
 * while a false negative costs a broken `lh` invocation. Erring permissive is
 * therefore the right trade — e.g. `echo 'a && lh b'` matches even though the
 * `lh` is quoted text.
 */
const LH_COMMAND_PATTERN =
  /(?:^|[\n;&|()`{]|\b(?:do|then|else|if|elif|while|until)\b)[\t ]*(?:(?:!|\btime)[\t ]+)*(?:[A-Za-z_]\w*=(?:'[^']*'|"[^"]*"|[^\s'"&;|]*)[\t ]+)*lh(?=[\s;&|)]|$)/;

export const isLhCommand = (command: string): boolean => LH_COMMAND_PATTERN.test(command);

/**
 * Env overrides for a workspace run executing ON THE USER'S DEVICE rather than
 * in the sandbox.
 *
 * A device shell has its own `lh` and its own stored credentials, so nothing
 * needs rewriting there — but without `LOBEHUB_WORKSPACE_ID` the CLI resolves
 * to personal scope, and a workspace agent asked to edit itself silently reads
 * and writes the wrong tenancy instead of failing.
 *
 * Applied to EVERY command of a workspace run, deliberately not gated on
 * `isLhCommand`. The device merges this into the spawned process environment,
 * so every descendant inherits it — which is the only way to reach an `lh` the
 * command invokes indirectly: `bash -lc 'lh whoami'`, a shell script, a
 * Makefile target, an npm script. Command-position detection sees none of
 * those, and unlike the sandbox path there is nothing here worth gating: this
 * mints no credential, it exports a non-secret scope id that only the LobeHub
 * CLI reads, so setting it on a command that never calls `lh` costs nothing.
 *
 * `LOBEHUB_JWT` is deliberately NOT sent: on a personal device the stored
 * credentials already are the caller's, so it buys nothing, while a workspace
 * device belongs to another member and shipping the caller's token onto their
 * machine would be a real credential leak. Auth stays with the device; only the
 * scope travels. A device owner who is not a member of that workspace now gets
 * an explicit error rather than a silent personal-scope write.
 */
export const buildDeviceLhEnv = (
  workspaceId: string | undefined,
): Record<string, string> | undefined =>
  workspaceId ? { LOBEHUB_WORKSPACE_ID: workspaceId } : undefined;

/** POSIX single-quoting, safe for any value including quotes and newlines. */
const shellSingleQuote = (value: string): string => `'${value.replaceAll("'", String.raw`'\''`)}'`;

/**
 * Detect and prepare `lh` CLI commands for execution in the cloud sandbox.
 *
 * Instead of rewriting every `lh` occurrence (which can only ever cover the
 * shell forms the regex happens to know), the command is left **byte-identical**
 * and a one-line shim is prepended:
 *
 * ```sh
 * lh() { LOBEHUB_JWT='…' LOBEHUB_SERVER='…' LOBEHUB_WORKSPACE_ID='…' npx -y @lobehub/cli "$@"; }
 * <original command>
 * ```
 *
 * A POSIX shell function is visible to subshells and command substitution, so
 * this resolves `lh` in every form the model can write — pipelines, `$(lh …)`,
 * `for … do lh …`, and every line of a multi-line script — while emitting the
 * JWT exactly once instead of per occurrence.
 *
 * The credentials are assignment-prefixed to `npx` INSIDE the function rather
 * than `export`ed around the script. Exporting would put a full user auth token
 * in the environment of every command the model wrote, where any later `env`,
 * `echo $LOBEHUB_JWT`, `curl` or child process could read and exfiltrate it —
 * and since detection is deliberately permissive, a script that merely mentions
 * `lh` in quoted text would get one too. Prefixing an external command is
 * well-defined POSIX and scopes the value to that one `npx` process. Nothing is
 * lost: the shim is a shell function, so it was never visible to a child shell
 * process (`sh -c 'lh …'`) that an exported variable would have reached.
 *
 * `LOBEHUB_WORKSPACE_ID` is what keeps a workspace run's CLI calls in the
 * workspace: without it the CLI resolves to personal scope and a workspace
 * agent cannot even find itself.
 */
export const preprocessLhCommand = async (
  command: string,
  userId: string,
  workspaceId?: string,
): Promise<PreprocessResult> => {
  if (!isLhCommand(command)) {
    return { command, isLhCommand: false, skipSkillLookup: false };
  }

  try {
    const jwt = await signUserJWT(userId);

    const serverUrl = isDev ? OFFICIAL_URL : appEnv.APP_URL;

    const envAssignments = [
      `LOBEHUB_JWT=${shellSingleQuote(jwt)}`,
      `LOBEHUB_SERVER=${shellSingleQuote(serverUrl)}`,
      ...(workspaceId ? [`LOBEHUB_WORKSPACE_ID=${shellSingleQuote(workspaceId)}`] : []),
    ].join(' ');

    // Newline-separated (not `;`-separated) so a command whose first line is a
    // comment or a shebang cannot swallow the shim.
    const finalCommand = [`lh() { ${envAssignments} npx -y @lobehub/cli "$@"; }`, command].join(
      '\n',
    );

    log(
      'Intercepted lh command for user %s (workspace %s), shim injected',
      userId,
      workspaceId ?? 'personal',
    );

    return { command: finalCommand, isLhCommand: true, skipSkillLookup: true };
  } catch (error) {
    log('Failed to sign user JWT for lh command: %O', error);
    return {
      command,
      error: 'Failed to authenticate for CLI execution',
      isLhCommand: true,
      skipSkillLookup: true,
    };
  }
};

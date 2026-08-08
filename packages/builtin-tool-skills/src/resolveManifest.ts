import type { BuiltinManifestResolver, BuiltinToolResolveContext } from '@lobechat/types';

import { SkillsManifest } from './manifest';
import { SkillsApiName } from './types';

/**
 * The exec-class APIs. Their runtime target follows the run's execution plan
 * (`apps/server/.../serverRuntimes/skills.ts`): a routed device
 * (`executionEnv: 'device'`) runs `execScript` ON the device; every other
 * environment runs in the server-side cloud sandbox. Descriptions are resolved
 * per plan below so the model is never told a location the runtime won't honor.
 */
const EXEC_API_NAMES = new Set<string>([
  SkillsApiName.execScript,
  SkillsApiName.exportFile,
  SkillsApiName.runCommand,
]);

/**
 * APIs hidden when a device is routed — the sandbox-oriented surface makes no
 * sense there. `runCommand` duplicates `lobe-local-system` runCommand on the
 * device, and `exportFile` exists to pull artifacts OUT of the sandbox; device
 * runs leave artifacts on the user's machine, where they already are. This
 * also restores the original desktop manifest shape, which only ever exposed
 * `execScript` (see `manifest.desktop.ts`).
 */
const DEVICE_HIDDEN_API_NAMES = new Set<string>([
  SkillsApiName.exportFile,
  SkillsApiName.runCommand,
]);

/**
 * Per-environment description preambles for the exec-class APIs. Descriptions
 * carry tool semantics only (where it runs, what credentials it has);
 * cross-tool arbitration lives in `EXEC_ENV_FACTS`.
 *
 * - `device`: a device is routed — `execScript` runs ON it: the skill archive
 *   is downloaded/extracted device-side and the command runs in the skill
 *   directory. LobeHub-managed credentials are deliberately NOT injected into
 *   devices (`injectCredsToSandbox` only targets the sandbox).
 * - `device-unrouted`: the user chose local-device execution but no device is
 *   routed this run — the model must disclose that instead of silently
 *   running machine-specific commands in the sandbox. Wording varies by
 *   unrouted reason (see `resolveUnroutedTexts`).
 * - `sandbox`: explicit sandbox target — current semantics, just made
 *   unambiguous that it is not the user's machine.
 *
 * `local` / `none` (and no context) keep the static manifest untouched.
 */
const EXEC_ENV_PREAMBLES: Partial<
  Record<NonNullable<BuiltinToolResolveContext['executionEnv']>, string>
> = {
  'device':
    "Execution environment: the user's selected device, not a cloud sandbox. The skill archive is auto-extracted on the device and the command runs in the skill directory. LobeHub-managed credentials (e.g. `GITHUB_TOKEN`) are NOT injected.",
  'device-unrouted':
    'Fallback execution environment: an isolated cloud sandbox. The user chose local-device execution but no device is routed this run — say so before running commands that assume their machine.',
  'sandbox': "Execution environment: an isolated cloud sandbox, not the user's machine.",
};

/**
 * Environment facts appended to the tool systemRole. Cross-tool arbitration
 * (which runCommand to default to) belongs here, not in the API descriptions:
 * descriptions get skimmed once the tool list is long, and a "prefer the
 * other tool" rule written on the tool NOT to pick is read too late — only
 * when the model is already considering it.
 */
const EXEC_ENV_FACTS: Partial<
  Record<NonNullable<BuiltinToolResolveContext['executionEnv']>, string>
> = {
  'device':
    'A local device is routed: `execScript` runs skill scripts on the device (archive auto-extracted, cwd = skill directory); use `lobe-local-system` runCommand for other shell commands. LobeHub-managed credentials are not available on the device.',
  'device-unrouted':
    'No local device is routed; shell commands execute in the cloud sandbox this run.',
};

/**
 * `device-unrouted` covers four reasons (`ExecutionPlanUnroutedReason`) that
 * split into two truths: the device the user counts on is OFFLINE
 * (`bound-device-offline` / `no-online-device`), vs a device is still
 * SELECTABLE (`no-bound-device` / `ambiguous-online-devices` — the
 * remote-device picker is active, so the prompt must steer toward selecting
 * one rather than declaring the device dead). Reason absent → keep the
 * neutral defaults above, which are true for all four.
 */
const resolveUnroutedTexts = (
  reason: BuiltinToolResolveContext['executionEnvUnroutedReason'],
): { fact?: string; preamble?: string } => {
  switch (reason) {
    case 'bound-device-offline':
    case 'no-online-device': {
      return {
        fact: 'Bound device offline; shell commands execute in the cloud sandbox this run.',
        preamble:
          'Fallback execution environment: an isolated cloud sandbox. The user chose their local device but it is offline — say so before running commands that assume their machine.',
      };
    }
    case 'ambiguous-online-devices':
    case 'no-bound-device': {
      return {
        fact: "No local device is selected yet (devices may be online). If the task needs the user's machine, select a device via the remote-device tool first; until then, shell commands execute in the cloud sandbox.",
        preamble:
          "Fallback execution environment: an isolated cloud sandbox. No local device is selected yet — if the task needs the user's machine, select an online device first instead of running machine-specific commands here.",
      };
    }
    default: {
      return {};
    }
  }
};

/**
 * Context-aware manifest for the lobe-skills tool: prefixes the exec-class API
 * descriptions with where they actually run, derived from the resolved
 * execution plan (see `BuiltinToolResolveContext.executionEnv`). Device runs
 * additionally drop the sandbox-only APIs (`runCommand` / `exportFile`).
 */
export const resolveSkillsManifest: BuiltinManifestResolver = (context) => {
  const basePreamble = context.executionEnv && EXEC_ENV_PREAMBLES[context.executionEnv];
  if (!basePreamble) return SkillsManifest;

  const isDeviceRun = context.executionEnv === 'device';
  const unrouted =
    context.executionEnv === 'device-unrouted'
      ? resolveUnroutedTexts(context.executionEnvUnroutedReason)
      : {};
  const preamble = unrouted.preamble ?? basePreamble;
  const fact = unrouted.fact ?? (context.executionEnv && EXEC_ENV_FACTS[context.executionEnv]);

  return {
    ...SkillsManifest,
    api: SkillsManifest.api
      .filter((api) => !isDeviceRun || !DEVICE_HIDDEN_API_NAMES.has(api.name))
      .map((api) =>
        EXEC_API_NAMES.has(api.name)
          ? { ...api, description: `${preamble} ${api.description}` }
          : api,
      ),
    ...(fact && {
      systemRole: `${SkillsManifest.systemRole}\n<execution_environment>\n${fact}\n</execution_environment>\n`,
    }),
  };
};

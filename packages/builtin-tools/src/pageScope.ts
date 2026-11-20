import type {
  BuiltinManifestResolver,
  BuiltinToolManifest,
  HumanInterventionConfig,
} from '@lobechat/types';

/**
 * `lh` anywhere in a command, the same permissive test the server uses to inject
 * the user's credentials into it (`LH_COMMAND_PATTERN` in `preprocessLhCommand`):
 * a false positive costs one extra confirmation, a false negative runs an
 * account-changing command unasked.
 */
const LH_INVOCATION = String.raw`(?<![\w./~-])lh(?![\w./-])`;

/**
 * In page scope the sandbox is how the page agent edits the page, and page
 * edits land as review diffs, so asking before each command would only add a
 * second confirmation for the same change. Commands that reach beyond the
 * sandbox still ask: `lh` acts on the user's account with their credentials.
 */
const PAGE_SCOPE_INTERVENTION: Record<string, HumanInterventionConfig> = {
  editFile: 'never',
  executeCode: 'never',
  moveFiles: 'never',
  runCommand: [
    { match: { command: { pattern: LH_INVOCATION, type: 'regex' } }, policy: 'required' },
    { policy: 'never' },
  ],
  writeFile: 'never',
};

export const resolveCloudSandboxInPageScope =
  (manifest: BuiltinToolManifest): BuiltinManifestResolver =>
  (context) => {
    if (context.scope !== 'page') return manifest;

    return {
      ...manifest,
      api: manifest.api.map((api) =>
        api.name in PAGE_SCOPE_INTERVENTION
          ? { ...api, humanIntervention: PAGE_SCOPE_INTERVENTION[api.name] }
          : api,
      ),
    };
  };

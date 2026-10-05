import type { BuiltinManifestResolver, BuiltinToolManifest } from '@lobechat/types';

// Page edits land as review diffs in the editor, so asking before each sandbox
// command would only add a second confirmation for the same change.
export const autoApproveInPageScope =
  (
    resolve: BuiltinManifestResolver | BuiltinToolManifest,
    apiNames: readonly string[],
  ): BuiltinManifestResolver =>
  (context) => {
    const manifest = typeof resolve === 'function' ? resolve(context) : resolve;
    if (!manifest || context.scope !== 'page') return manifest;

    return {
      ...manifest,
      api: manifest.api.map((api) =>
        apiNames.includes(api.name) ? { ...api, humanIntervention: 'never' as const } : api,
      ),
    };
  };

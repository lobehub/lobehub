import { builtinTools } from '@lobechat/builtin-tools';
import type { LobeToolManifest } from '@lobechat/context-engine';

interface ResolveShareToolManifestOptions {
  allowedApiNames: readonly string[];
  identifier: string;
}

const hasExactApiSet = (
  manifest: LobeToolManifest,
  allowedApiNames: readonly string[],
): boolean => {
  const allowed = new Set(allowedApiNames);

  return manifest.api.length === allowed.size && manifest.api.every((api) => allowed.has(api.name));
};

/**
 * Transitional bridge between Agent Share policy filtering and builtin-owned
 * restricted manifests.
 *
 * Keep this adapter separate from `shareGate.ts`: a future shared tool
 * finalization pipeline can move the same optional resolver without retaining
 * Agent Share-specific registry lookup or Documents/Memory knowledge in the
 * gate. The exact-set check prevents a tool-owned projection from widening the
 * policy-approved API set.
 */
export const resolveShareToolManifest = ({
  allowedApiNames,
  identifier,
}: ResolveShareToolManifestOptions): LobeToolManifest | undefined => {
  const resolver = builtinTools.find(
    (tool) => tool.identifier === identifier,
  )?.resolveRestrictedManifest;
  const manifest = resolver?.({ allowedApiNames, restriction: 'agentShare' });

  if (
    !manifest ||
    manifest.identifier !== identifier ||
    !hasExactApiSet(manifest, allowedApiNames)
  ) {
    return undefined;
  }

  return manifest;
};

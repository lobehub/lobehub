import type { LobeToolManifest, ResolvedToolSet, UniformTool } from '../engine/tools/types';
import { generateToolsFromManifest } from '../engine/tools/utils';
import { ON_DEMAND_BOOTSTRAP_MANIFESTS } from './bootstrapManifests';

/**
 * The bootstrap manifests use the builtin tool schema. The generic tool
 * pipeline only needs the fields covered by `LobeToolManifest`.
 */
export const getOnDemandBootstrapManifests = (): readonly LobeToolManifest[] =>
  ON_DEMAND_BOOTSTRAP_MANIFESTS as readonly LobeToolManifest[];

/**
 * Builds the only tool payload allowed in the stable part of an on-demand
 * request. Native intervention, renderer, and execution metadata stay on the
 * real manifests; no synthetic `invoke` escape hatch is introduced.
 */
export const buildOnDemandBootstrapToolSet = (): ResolvedToolSet => {
  const manifests = getOnDemandBootstrapManifests();
  const manifestMap: Record<string, LobeToolManifest> = {};
  const sourceMap: ResolvedToolSet['sourceMap'] = {};
  const executorMap: NonNullable<ResolvedToolSet['executorMap']> = {};

  for (const manifest of manifests) {
    manifestMap[manifest.identifier] = manifest;
    sourceMap[manifest.identifier] = 'builtin';
    executorMap[manifest.identifier] = 'server';
  }

  return {
    enabledToolIds: manifests.map((manifest) => manifest.identifier),
    executorMap,
    manifestMap,
    promptManifestMap: { ...manifestMap },
    sourceMap,
    tools: manifests.flatMap((manifest) => generateToolsFromManifest(manifest)),
  };
};

export const buildOnDemandBootstrapTools = (): UniformTool[] =>
  buildOnDemandBootstrapToolSet().tools;

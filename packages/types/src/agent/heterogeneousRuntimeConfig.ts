import type { HeterogeneousProviderConfig, HeterogeneousTopicPin } from './agencyConfig';
import { applyTopicModelToHeterogeneousProvider } from './agencyConfig';
import {
  getHeteroSelectorCapability,
  HETEROGENEOUS_AGENT_DEFAULT_SELECTION,
} from './heteroSelectorCapabilities';

/** The configuration layer that supplies one displayed runtime setting. */
export type HeterogeneousRuntimeConfigSource = 'task' | 'topic' | 'agent' | 'runtime';

/** One effective setting and the layer that supplied it. */
export interface HeterogeneousRuntimeConfigField {
  /** The user-facing configuration dimension. */
  key: 'runtime' | 'model' | 'mode' | 'effort' | 'speed';
  /** The winning configuration layer, including unresolved device defaults. */
  source: HeterogeneousRuntimeConfigSource;
  /** A runtime selection; `default` remains unresolved until the CLI starts. */
  value: string;
}

/**
 * Resolves the settings displayed for a Task or one of its Topics.
 *
 * Use when:
 * - Showing the next Task run's model override.
 * - Inspecting a particular Topic's pinned model and effort.
 *
 * Expects:
 * - The assignee's provider, and only the pin belonging to the displayed resource.
 * - Task and Topic pins use the runtime's existing auth-mode and capability rules.
 *
 * Returns:
 * - Runtime and its supported selector dimensions with per-field provenance.
 * - Unresolved CLI defaults remain explicit; device-selected values are never inferred.
 */
export const resolveHeterogeneousRuntimeConfig = (
  provider: HeterogeneousProviderConfig,
  pin?: HeterogeneousTopicPin,
  pinSource: 'task' | 'topic' = 'task',
): HeterogeneousRuntimeConfigField[] => {
  const capability = getHeteroSelectorCapability(provider.type);
  // Connected Tasks may store only a model; no ordinary Agent provider exists
  // to backfill it. Topic pins retain their stricter stored-provider semantics.
  const effectivePin =
    pinSource === 'task' && pin?.model ? { ...pin, provider: pin.provider ?? provider.type } : pin;
  const withModel = applyTopicModelToHeterogeneousProvider(
    provider,
    effectivePin?.model
      ? { model: effectivePin.model, provider: effectivePin.provider }
      : undefined,
  );
  const effective = applyTopicModelToHeterogeneousProvider(provider, effectivePin);
  const model =
    (effective.authMode === 'api'
      ? effective.apiConfig?.model
      : (capability?.model?.resolve(effective) ?? effective.model)) ||
    HETEROGENEOUS_AGENT_DEFAULT_SELECTION;
  const fields: HeterogeneousRuntimeConfigField[] = [
    { key: 'runtime', source: 'agent', value: effective.type },
  ];
  if (capability?.model) {
    fields.push({
      key: 'model',
      source: withModel !== provider ? pinSource : model === 'default' ? 'runtime' : 'agent',
      value: model,
    });
  }

  if (capability?.mode) {
    const mode = capability.mode.resolve(effective);
    fields.push({
      key: 'mode',
      source: mode === 'default' ? 'runtime' : 'agent',
      value: mode,
    });
  }

  if (capability?.effort) {
    const effort = capability.effort.resolve(effective);
    fields.push({
      key: 'effort',
      source: pin?.effort !== undefined ? pinSource : effort === 'default' ? 'runtime' : 'agent',
      value: effort,
    });
  }

  if (capability?.speed) {
    // Inspect the configured CLI value even if this model cannot select it in the
    // composer; hiding an existing flag would misrepresent the dispatched args.
    const speed = capability.speed.resolve(effective);
    fields.push({
      key: 'speed',
      source: pin?.speed !== undefined ? pinSource : speed === 'default' ? 'runtime' : 'agent',
      value: speed,
    });
  }

  return fields;
};

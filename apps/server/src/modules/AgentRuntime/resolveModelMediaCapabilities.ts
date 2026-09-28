import { isRecord } from '@lobechat/utils/object';
import type { LobeDefaultAiModelListItem, ModelAbilities } from 'model-bank';

interface ResolveModelMediaCapabilitiesParams {
  builtinModels: LobeDefaultAiModelListItem[];
  model: string;
  provider: string;
  /** The database stores abilities as an untyped JSON column. */
  userAbilities?: unknown;
}

/**
 * Match the client's enabled-model merge: a nonempty user abilities object
 * replaces the bundled abilities, including explicit false values. Media
 * routing and context assembly must agree or native attachments are discarded.
 */
export const resolveModelMediaCapabilities = ({
  builtinModels,
  model,
  provider,
  userAbilities,
}: ResolveModelMediaCapabilitiesParams):
  Pick<ModelAbilities, 'audio' | 'video' | 'vision'> | undefined => {
  if (isRecord(userAbilities) && Object.keys(userAbilities).length > 0) {
    return {
      audio: userAbilities.audio === true,
      video: userAbilities.video === true,
      vision: userAbilities.vision === true,
    };
  }

  // Preserve the canonical-model fallback used by aggregation providers.
  return (
    builtinModels.find((item) => item.id === model && item.providerId === provider) ??
    builtinModels.find((item) => item.id === model)
  )?.abilities;
};

import { isRecord } from '@lobechat/utils/object';
import type { AiFullModelCard, LobeDefaultAiModelListItem, ModelAbilities } from 'model-bank';

interface ResolveModelMediaCapabilitiesParams {
  builtinModels: LobeDefaultAiModelListItem[];
  model: string;
  provider: string;
  /** Env-configured provider model list (`*_MODEL_LIST` / `serverModelLists`). */
  serverModels?: AiFullModelCard[];
  /** The database stores abilities as an untyped JSON column. */
  userAbilities?: unknown;
}

/**
 * Match the client's enabled-model merge: a nonempty user abilities object
 * replaces env-configured and bundled abilities (including explicit false
 * values), and env-configured `*_MODEL_LIST` abilities override bundled
 * defaults. Media routing and context assembly must agree or native
 * attachments are discarded.
 */
export const resolveModelMediaCapabilities = ({
  builtinModels,
  model,
  provider,
  serverModels,
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

  const serverModel =
    serverModels?.find((item) => item.id === model) ??
    serverModels?.find((item) => item.config?.deploymentName === model);
  if (serverModel?.abilities && Object.keys(serverModel.abilities).length > 0) {
    return serverModel.abilities;
  }

  // Preserve the canonical-model fallback used by aggregation providers.
  return (
    builtinModels.find((item) => item.id === model && item.providerId === provider) ??
    builtinModels.find((item) => item.id === model)
  )?.abilities;
};

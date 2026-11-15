import { loadModels } from '@lobechat/business-model-bank/model-config';
import type { LobeChatDatabase } from '@lobechat/database';
import type { MusicModelParamsSchema, Pricing } from 'model-bank';

import { AiModelModel } from '@/database/models/aiModel';

/** Upper bound on songs per request; guards against a malformed model card. */
const MAX_OUTPUTS_PER_REQUEST = 4;

export interface MusicModelCard {
  /** Songs one request returns; the batch pre-creates this many generations */
  outputsPerRequest: number;
  parameters?: MusicModelParamsSchema;
  pricing?: Pricing;
  type: string;
}

interface BuiltinModelLike {
  id: string;
  outputsPerRequest?: number;
  parameters?: unknown;
  pricing?: Pricing;
  providerId?: string;
  type?: string;
}

const isNonEmptyObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && Object.keys(value).length > 0;

const clampOutputs = (value: unknown) =>
  typeof value === 'number' && Number.isInteger(value) && value > 0
    ? Math.min(value, MAX_OUTPUTS_PER_REQUEST)
    : 1;

/**
 * Resolve the card of the model a music request targets: the user's own model row first (custom
 * models and overrides of built-in cards), then the built-in model bank. Returns `undefined`
 * when the model is unknown to both, so the caller can reject it.
 */
export const resolveMusicModelCard = async ({
  db,
  model,
  provider,
  userId,
  workspaceId,
}: {
  db: LobeChatDatabase;
  model: string;
  provider: string;
  userId: string;
  workspaceId?: string;
}): Promise<MusicModelCard | undefined> => {
  const builtinModels = (await loadModels()) as BuiltinModelLike[];
  const builtin =
    builtinModels.find((item) => item.id === model && item.providerId === provider) ??
    // A custom provider (its own id) can serve a built-in model id
    builtinModels.find((item) => item.id === model && item.type === 'text2music');

  const row = await new AiModelModel(db, userId, workspaceId).findByIdAndProvider(model, provider);
  const userRow = row && !AiModelModel.isPreferenceOnlyRow(row) ? row : undefined;

  const type = userRow?.type ?? builtin?.type;
  if (!type) return;

  const parameters = isNonEmptyObject(userRow?.parameters)
    ? userRow.parameters
    : isNonEmptyObject(builtin?.parameters)
      ? builtin.parameters
      : undefined;

  return {
    outputsPerRequest: clampOutputs(builtin?.outputsPerRequest),
    parameters: parameters as MusicModelParamsSchema | undefined,
    pricing: (userRow?.pricing as Pricing | null | undefined) ?? builtin?.pricing,
    type,
  };
};

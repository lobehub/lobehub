import type { HeterogeneousApiConfig } from '@lobechat/types';

interface EnabledChatModelRef {
  id: string;
  providerId: string;
  type: string;
}

interface ValidateClaudeCodeApiBindingInput {
  apiConfig?: HeterogeneousApiConfig;
  enabledModels: readonly EnabledChatModelRef[];
  providerEnabled: boolean;
  providerSdkType?: string;
}

export type ClaudeCodeApiBindingError =
  | { code: 'configMissing' }
  | { code: 'modelUnavailable'; model: string; providerId: string }
  | { code: 'providerUnavailable'; providerId: string };

interface ResolveClaudeCodeApiBindingGuardInput {
  active: boolean;
  error?: ClaudeCodeApiBindingError;
  isReady: boolean;
}

export const resolveClaudeCodeApiBindingGuard = ({
  active,
  error,
  isReady,
}: ResolveClaudeCodeApiBindingGuardInput) => ({
  blocked: active && (!isReady || !!error),
  error: active && isReady ? error : undefined,
});

/** Validate the reference-only binding shared by the chat guard and Desktop-local spawn. */
export const validateClaudeCodeApiBinding = ({
  apiConfig,
  enabledModels,
  providerEnabled,
  providerSdkType,
}: ValidateClaudeCodeApiBindingInput): ClaudeCodeApiBindingError | undefined => {
  if (!apiConfig?.providerId || !apiConfig.model) return { code: 'configMissing' };

  if (!providerEnabled || providerSdkType !== 'anthropic') {
    return { code: 'providerUnavailable', providerId: apiConfig.providerId };
  }

  const boundModels = [apiConfig.model, apiConfig.smallFastModel].filter(
    (model): model is string => !!model,
  );
  const unavailableModel = boundModels.find(
    (boundModel) =>
      !enabledModels.some(
        (model) =>
          model.providerId === apiConfig.providerId &&
          model.id === boundModel &&
          model.type === 'chat',
      ),
  );

  return unavailableModel
    ? {
        code: 'modelUnavailable',
        model: unavailableModel,
        providerId: apiConfig.providerId,
      }
    : undefined;
};

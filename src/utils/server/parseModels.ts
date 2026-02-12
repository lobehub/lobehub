import { getModelPropertyWithFallback } from '@lobechat/model-runtime';
import { merge } from '@lobechat/utils';
import { produce } from 'immer';
import { type AiFullModelCard, type AiModelType } from 'model-bank';

/**
 * Parse model string to add or remove models.
 */
export const parseModelString = async (
  providerId: string,
  modelString: string = '',
  withDeploymentName = false,
) => {
  const models: AiFullModelCard[] = [];
  let removeAll = false;
  const removedModels: string[] = [];
  const modelNames = modelString.split(/[,，]/).filter(Boolean);

  for (const item of modelNames) {
    const disable = item.startsWith('-');
    const nameConfig = item.startsWith('+') || item.startsWith('-') ? item.slice(1) : item;
    const [idAndDisplayName, ...capabilities] = nameConfig.split('<');
    let [id, displayName] = idAndDisplayName.split('=');

    let deploymentName: string | undefined;

    if (withDeploymentName) {
      [id, deploymentName] = id.split('->');
    }

    if (disable) {
      // Disable all models.
      if (id === 'all') {
        removeAll = true;
      }
      removedModels.push(id);
      continue;
    }

    // remove empty model name
    if (!item.trim().length) {
      continue;
    }

    // Remove duplicate model entries.
    const existingIndex = models.findIndex(({ id: n }) => n === id);
    if (existingIndex !== -1) {
      models.splice(existingIndex, 1);
    }

    // Use new type lookup function, prioritizing same provider first, then fallback to other providers
    const modelType: AiModelType = await getModelPropertyWithFallback<AiModelType>(
      id,
      'type',
      providerId,
    );

    const model: AiFullModelCard = {
      abilities: {},
      displayName: displayName || undefined,
      id,
      type: modelType,
    };

    if (deploymentName) {
      model.config = { deploymentName };
    }

    if (capabilities.length > 0) {
      const [maxTokenStr, ...capabilityList] = capabilities[0].replace('>', '').split(':');
      model.contextWindowTokens = parseInt(maxTokenStr, 10) || undefined;

      for (const capability of capabilityList) {
        switch (capability) {
          case 'reasoning': {
            model.abilities!.reasoning = true;
            break;
          }
          case 'vision': {
            model.abilities!.vision = true;
            break;
          }
          case 'fc': {
            model.abilities!.functionCall = true;
            break;
          }
          case 'file': {
            model.abilities!.files = true;
            break;
          }
          case 'video': {
            model.abilities!.video = true;
            break;
          }
          case 'search': {
            model.abilities!.search = true;
            break;
          }
          case 'imageOutput': {
            model.abilities!.imageOutput = true;
            break;
          }
          default: {
            console.warn(`Unknown capability: ${capability}`);
          }
        }
      }
    }

    models.push(model);
  }

  return {
    add: models,
    removeAll,
    removed: removedModels,
  };
};

/**
 * Extract a special method to process chatModels
 */
export const transformToAiModelList = async ({
  modelString = '',
  defaultModels,
  providerId,
  withDeploymentName = false,
}: {
  defaultModels: AiFullModelCard[];
  modelString?: string;
  providerId: string;
  withDeploymentName?: boolean;
}): Promise<AiFullModelCard[] | undefined> => {
  if (!modelString) return undefined;

  const modelConfig = await parseModelString(providerId, modelString, withDeploymentName);
  let chatModels = modelConfig.removeAll ? [] : defaultModels;

  // Handle removal logic
  if (!modelConfig.removeAll) {
    chatModels = chatModels.filter((m) => !modelConfig.removed.includes(m.id));
  }

  // Asynchronously load configuration
  const { LOBE_DEFAULT_MODEL_LIST } = await import('model-bank');

  return produce(chatModels, (draft) => {
    // Handle add or replace logic
    for (const toAddModel of modelConfig.add) {
      // first try to find the model in LOBE_DEFAULT_MODEL_LIST to confirm if it is a known model
      let knownModel = LOBE_DEFAULT_MODEL_LIST.find(
        (model) => model.id === toAddModel.id && model.providerId === providerId,
      );

      if (!knownModel) {
        knownModel = LOBE_DEFAULT_MODEL_LIST.find((model) => model.id === toAddModel.id);
        if (knownModel) knownModel.providerId = providerId;
      }
      if (withDeploymentName) {
        toAddModel.config = toAddModel.config || {};
        if (!toAddModel.config.deploymentName) {
          toAddModel.config.deploymentName = knownModel?.config?.deploymentName ?? toAddModel.id;
        }
      }

      // if the model is known, update it based on the known model
      if (knownModel) {
        const index = draft.findIndex((model) => model.id === toAddModel.id);
        const modelInList = draft[index];

        // if the model is already in chatModels, update it
        if (modelInList) {
          draft[index] = merge(modelInList, {
            ...toAddModel,
            displayName: toAddModel.displayName || modelInList.displayName || modelInList.id,
            enabled: true,
          });
        } else {
          // if the model is not in chatModels, add it
          draft.push(
            merge(knownModel, {
              ...toAddModel,
              displayName: toAddModel.displayName || knownModel.displayName || knownModel.id,
              enabled: true,
            }),
          );
        }
      } else {
        // if the model is not in LOBE_DEFAULT_MODEL_LIST, add it as a new custom model
        draft.push({
          ...toAddModel,
          displayName: toAddModel.displayName || toAddModel.id,
          enabled: true,
        });
      }
    }
  });
};

export const extractEnabledModels = async (
  providerId: string,
  modelString: string = '',
  withDeploymentName = false,
) => {
  const modelConfig = await parseModelString(providerId, modelString, withDeploymentName);
  const list = modelConfig.add.map((m) => m.id);

  if (list.length === 0) return;

  return list;
};

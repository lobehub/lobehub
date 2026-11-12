import type { ChatModelCard } from '@lobechat/types';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import debug from 'debug';
import type { AiModelType } from 'model-bank';
import { LOBE_DEFAULT_MODEL_LIST } from 'model-bank';

import { getModelPropertyWithFallback } from '../../utils/getFallbackModelProperty';
import { postProcessModelList } from '../../utils/postProcessModelList';
import type { OpenAICompatibleRuntimeContext } from './context';
import type { OpenAICompatibleFactoryOptions } from './factoryOptions';

// the model contains the following keywords is not a chat model, so we should filter them out
export const CHAT_MODELS_BLOCK_LIST = [
  'embedding',
  'davinci',
  'curie',
  'moderation',
  'ada',
  'babbage',
  'tts',
  'whisper',
  'dall-e',
];

export const listOpenAICompatibleModels = async (
  runtime: OpenAICompatibleRuntimeContext,
  factory: OpenAICompatibleFactoryOptions,
) => {
  const { models } = factory;
  const log = debug(`${runtime.logPrefix}:models`);
  log('fetching available models');

  let resultModels: ChatModelCard[];
  if (typeof models === 'function') {
    log('using custom models function');
    resultModels = await models({ client: runtime.client, options: runtime._options });
  } else {
    log('fetching models from client API');
    const list = await runtime.client.models.list();
    resultModels = list.data
      .filter((model) => {
        return CHAT_MODELS_BLOCK_LIST.every((keyword) => !model.id.toLowerCase().includes(keyword));
      })
      .map((item) => {
        if (models?.transformModel) {
          return models.transformModel(item);
        }

        const toReleasedAt = () => {
          if (!item.created) return;
          dayjs.extend(utc);

          // guarantee item.created in Date String format
          if (
            typeof (item.created as any) === 'string' ||
            // or in milliseconds
            item.created.toFixed(0).length === 13
          ) {
            return dayjs.utc(item.created).format('YYYY-MM-DD');
          }

          // by default, the created time is in seconds
          return dayjs.utc(item.created * 1000).format('YYYY-MM-DD');
        };

        // TODO: should refactor after remove v1 user/modelList code
        const knownModel = LOBE_DEFAULT_MODEL_LIST.find((model) => model.id === item.id);

        if (knownModel) {
          const releasedAt = knownModel.releasedAt ?? toReleasedAt();

          return { ...knownModel, releasedAt };
        }

        return {
          id: item.id,
          releasedAt: toReleasedAt(),
        };
      })

      .filter(Boolean) as ChatModelCard[];
  }

  log('fetched %d models', resultModels.length);

  return await postProcessModelList(resultModels, (modelId) =>
    getModelPropertyWithFallback<AiModelType>(modelId, 'type'),
  );
};

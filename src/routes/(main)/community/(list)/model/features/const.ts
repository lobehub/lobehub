import { DEFAULT_MODEL_PROVIDER_LIST } from 'model-bank/modelProviders';

const providerMap: { [key: string]: string } = {};

DEFAULT_MODEL_PROVIDER_LIST.filter((item) => item.chatModels.length > 0).forEach((item) => {
  providerMap[item.id] = item.name;
});

export { providerMap };

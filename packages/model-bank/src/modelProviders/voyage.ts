import type { ModelProviderCard } from '../types';

/**
 * Embedding only: the runtime serves `embeddings()` and has no chat endpoint, so the
 * connection checker (which sends a chat message) is hidden and the catalog is static.
 * @see https://docs.voyageai.com/docs/embeddings
 */
const Voyage: ModelProviderCard = {
  apiKeyUrl: 'https://dashboard.voyageai.com/organization/api-keys',
  chatModels: [],
  description:
    'Voyage AI builds embedding models for retrieval, including general-purpose, code, finance and law models, and contextualized chunk embeddings.',
  id: 'voyage',
  modelsUrl: 'https://docs.voyageai.com/docs/embeddings',
  name: 'Voyage AI',
  settings: {
    disableBrowserRequest: true,
    proxyUrl: {
      placeholder: 'https://api.voyageai.com/v1',
    },
    showAddNewModel: false,
    showChecker: false,
    showModelFetcher: false,
  },
  url: 'https://www.voyageai.com',
};

export default Voyage;

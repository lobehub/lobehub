import { DEFAULT_FILES_CONFIG } from '@/const/settings/knowledge';
import { type SystemEmbeddingConfig } from '@/types/knowledgeBase';
import { type FilesConfig } from '@/types/user/settings/filesConfig';

const protectedKeys = Object.keys({
  embedding_model: null,
  query_mode: null,
  reranker_model: null,
});

export const parseFilesConfig = (envString: string = ''): SystemEmbeddingConfig => {
  if (!envString) return DEFAULT_FILES_CONFIG;
  const config: FilesConfig = {} as any;

  // Handle full-width commas and extra spaces
  const envValue = envString.replaceAll('，', ',').trim();

  const pairs = envValue.split(',');

  for (const pair of pairs) {
    const [key, value] = pair.split('=').map((s) => s.trim());

    if (key && value) {
      const [provider, ...modelParts] = value.split('/');
      const model = modelParts.join('/');

      if (protectedKeys.includes(key)) {
        switch (key) {
          case 'embedding_model': {
            if (!provider || !model) {
              throw new Error(
                'Invalid environment variable format.  expected of the form embedding_model=provider/model',
              );
            }
            config.embeddingModel = { model: model.trim(), provider: provider.trim() };
            break;
          }
          case 'reranker_model': {
            if (!provider || !model) {
              throw new Error(
                'Invalid environment variable format.  expected of the form reranker_model=provider/model',
              );
            }
            config.rerankerModel = { model: model.trim(), provider: provider.trim() };
            break;
          }
          case 'query_mode': {
            config.queryMode = value;
            break;
          }
          default: {
            throw new Error(
              'Invalid environment variable format. expected one of embedding_model, reranker_model, query_mode',
            );
          }
        }
      }
    } else {
      throw new Error('Invalid environment variable format.');
    }
  }
  return config;
};

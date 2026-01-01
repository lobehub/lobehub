import { type SQL, and } from 'drizzle-orm';
import { ModelProvider } from 'model-bank';

import { DEFAULT_FILE_EMBEDDING_MODEL_ITEM } from '@/const/settings/knowledge';
import { UserMemoryModel } from '@/database/models/userMemory';
import { authedProcedure,  } from '@/libs/trpc/lambda';
import { keyVaults, serverDatabase } from '@/libs/trpc/lambda/middleware';
import { getServerDefaultFilesConfig } from '@/server/globalConfig';
import { initModelRuntimeWithUserPayload } from '@/server/modules/ModelRuntime';
import { type ClientSecretPayload } from '@/types/auth';



export const EMBEDDING_VECTOR_DIMENSION = 1024;

export const memoryProcedure = authedProcedure
  .use(serverDatabase)
  .use(keyVaults)
  .use(async (opts) => {
    const { ctx } = opts;
    return opts.next({
      ctx: {
        memoryModel: new UserMemoryModel(ctx.serverDB, ctx.userId),
      },
    });
  });

export const getEmbeddingRuntime = async (jwtPayload: ClientSecretPayload) => {
  const agentRuntime = await initModelRuntimeWithUserPayload(ModelProvider.OpenAI, jwtPayload);
  const { model: embeddingModel } =
    getServerDefaultFilesConfig().embeddingModel || DEFAULT_FILE_EMBEDDING_MODEL_ITEM;

  return { agentRuntime, embeddingModel };
};

export const createEmbedder = (agentRuntime: any, embeddingModel: string) => {
  return async (value?: string | null): Promise<number[] | undefined> => {
    if (!value || value.trim().length === 0) return undefined;

    const embeddings = await agentRuntime.embeddings({
      dimensions: EMBEDDING_VECTOR_DIMENSION,
      input: value,
      model: embeddingModel,
    });

    return embeddings?.[0];
  };
};

export const combineConditions = (conditions: Array<SQL | undefined>): SQL | undefined => {
  const filtered = conditions.filter((condition): condition is SQL => condition !== undefined);
  if (filtered.length === 0) return undefined;
  if (filtered.length === 1) return filtered[0];

  return and(...filtered);
};

export const normalizeEmbeddable = (value?: string | null): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : undefined;
};

export {router} from '@/libs/trpc/lambda';
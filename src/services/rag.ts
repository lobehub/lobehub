import { lambdaClient } from '@/libs/trpc/client';
import type {SemanticSearchSchemaType} from '@/types/rag';

class RAGService {
  parseFileContent = async (id: string, skipExist?: boolean) => {
    return lambdaClient.document.parseFileContent.mutate({ id, skipExist });
  };

  createParseFileTask = async (id: string, skipExist?: boolean) => {
    return lambdaClient.chunk.createParseFileTask.mutate({ id, skipExist });
  };

  retryParseFile = async (id: string) => {
    return lambdaClient.chunk.retryParseFileTask.mutate({ id });
  };

  createEmbeddingChunksTask = async (id: string) => {
    return lambdaClient.chunk.createEmbeddingChunksTask.mutate({ id });
  };

  semanticSearch = async (query: string, fileIds?: string[]) => {
    return lambdaClient.chunk.semanticSearch.mutate({ fileIds, query });
  };

  semanticSearchForChat = async (params: SemanticSearchSchemaType, signal?: AbortSignal) => {
    return lambdaClient.chunk.semanticSearchForChat.mutate(params, { signal });
  };

  getFileContents = async (fileIds: string[], signal?: AbortSignal) => {
    return lambdaClient.chunk.getFileContents.mutate({ fileIds }, { signal });
  };

  deleteMessageRagQuery = async (id: string) => {
    return lambdaClient.message.removeMessageQuery.mutate({ id });
  };
}

export const ragService = new RAGService();

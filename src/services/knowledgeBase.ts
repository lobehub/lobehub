import { lambdaClient } from '@/libs/trpc/client';
import type {CreateKnowledgeBaseParams} from '@/types/knowledgeBase';

class KnowledgeBaseService {
  createKnowledgeBase = async (params: CreateKnowledgeBaseParams) => {
    return lambdaClient.knowledgeBase.createKnowledgeBase.mutate(params);
  };

  getKnowledgeBaseList = async () => {
    return lambdaClient.knowledgeBase.getKnowledgeBases.query();
  };

  getKnowledgeBaseById = async (id: string) => {
    return lambdaClient.knowledgeBase.getKnowledgeBaseById.query({ id });
  };

  updateKnowledgeBaseList = async (id: string, value: any) => {
    return lambdaClient.knowledgeBase.updateKnowledgeBase.mutate({ id, value });
  };

  deleteKnowledgeBase = async (id: string) => {
    return lambdaClient.knowledgeBase.removeKnowledgeBase.mutate({ id });
  };

  addFilesToKnowledgeBase = async (knowledgeBaseId: string, ids: string[]) => {
    return lambdaClient.knowledgeBase.addFilesToKnowledgeBase.mutate({ ids, knowledgeBaseId });
  };

  removeFilesFromKnowledgeBase = async (knowledgeBaseId: string, ids: string[]) => {
    return lambdaClient.knowledgeBase.removeFilesFromKnowledgeBase.mutate({ ids, knowledgeBaseId });
  };
}

export const knowledgeBaseService = new KnowledgeBaseService();
